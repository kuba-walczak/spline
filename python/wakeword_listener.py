"""Wake word detection, level metering and dictation for the chat composer.

Reads framed messages from stdin, one of two kinds:

    byte 0      type       0x41 'A' = audio, 0x43 'C' = command
    bytes 1..4  uint32 LE  payload length
    bytes 5..   payload    'A': raw 16kHz mono int16 LE PCM
                           'C': UTF-8 JSON, one of
                                {"cmd": "listen", "on": true}
                                {"cmd": "meter",  "on": true}
                                {"cmd": "config", "silenceDb": -45, "silenceMs": 1500}

Framing rather than a raw PCM stream because the mode is toggled constantly and reloading both
models to change it would cost a second or more of deafness every time. It also keeps stdin int16
aligned, which a fixed-size read only ever was by luck.

Writes one line per event to stdout:

    READY                  both models loaded
    WAKE <score>           wake word heard
    LEVEL <dbfs>           input level, ~10/s, only while metering
    SEGMENT <text>         one transcribed phrase
    SILENCE                the mic has been quiet for the configured duration

Transcription runs on its own thread, fed by a queue. It has to: whisper tiny is well short of
realtime on CPU, so transcribing inline would put the silence countdown, the level meter and the
wake window several seconds behind the microphone - and a wake word spoken to switch voice mode off
would go unheard for as long as the last phrase took to transcribe. SEGMENT still lands before the
SILENCE that follows it, because one queue with one consumer preserves that order without the read
loop having to wait. WAKE and LEVEL deliberately overtake, which is what keeps the toggle and the
meter responsive.

Spawned as a child process by src/main/services/wakeWordWorker.ts, which owns mic capture (via
PvRecorder) and streams frames to this process's stdin.
"""

import ctypes
import json
import math
import queue
import re
import struct
import sys
import threading
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from livekit.wakeword import WakeWordModel

SAMPLE_RATE = 16000
WINDOW_SAMPLES = SAMPLE_RATE * 2  # ~2s window, as recommended by WakeWordModel
STEP_SAMPLES = SAMPLE_RATE // 2  # run inference every 500ms of new audio
THRESHOLD = 0.5
DEBOUNCE_SAMPLES = SAMPLE_RATE * 2  # ignore repeat detections within 2s

# How much quiet ends a phrase and sends it to be transcribed. Kept clear of STEP_SAMPLES: the two
# being equal would race a phrase flush against the wake inference that may be about to discard it.
PHRASE_ENDPOINT_SAMPLES = SAMPLE_RATE * 7 // 10  # 700ms
# A phrase this long is cut and transcribed as it stands, so that talking without pausing still
# produces text rather than an ever-growing buffer.
MAX_PHRASE_SAMPLES = SAMPLE_RATE * 15
# Below this much actual speech a phrase is noise, and whisper answers noise with invention.
MIN_VOICED_SAMPLES = SAMPLE_RATE // 4  # 250ms

TYPE_AUDIO = b"A"
TYPE_COMMAND = b"C"
HEADER_SIZE = 5
MAX_PAYLOAD = 1 << 20

DEFAULT_SILENCE_DB = -45.0
DEFAULT_SILENCE_MS = 1500
# The configured duration is held above the phrase endpoint, so the send never overtakes the
# transcription of the phrase it is meant to carry. Guards a hand-edit of the Config page.
MIN_SILENCE_MS = PHRASE_ENDPOINT_SAMPLES * 1000 // SAMPLE_RATE + 100

MODEL_NAME = "hey_livekit"
MODEL_PATH = Path(__file__).parent / "models" / f"{MODEL_NAME}.onnx"

BELOW_NORMAL_PRIORITY_CLASS = 0x00004000

# Whisper renders the wake word a dozen ways, and on deactivation the phrase can land inside the
# phrase being closed. The renderer drops those anyway; this is the cheap backstop.
WAKE_PHRASE_RE = re.compile(r"^\W*hey[\s,]*live\s*kit\b[\s,.!?:;-]*", re.IGNORECASE)
# What whisper tiny says when handed something that is not speech.
HALLUCINATIONS = {
    "thank you.",
    "thank you",
    "thanks for watching.",
    "thanks for watching!",
    "you",
    "bye.",
    "[blank_audio]",
    "(buzzing)",
    "(silence)",
}

_stdout_lock = threading.Lock()


def emit(line: str) -> None:
    # Two threads write here, so the lock is what keeps a line whole.
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def log(message: str) -> None:
    print(f"[wakeword] {message}", file=sys.stderr, flush=True)


def _lower_process_priority() -> None:
    # Keep ONNX/whisper inference from competing with the Electron UI thread for CPU.
    if sys.platform == "win32":
        kernel32 = ctypes.windll.kernel32
        kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)


def read_exact(stream, size: int) -> bytes | None:
    """Reads exactly `size` bytes. `None` means the pipe closed - the worker is gone."""
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_message(stream) -> tuple[bytes, bytes] | None:
    header = read_exact(stream, HEADER_SIZE)
    if header is None:
        return None
    kind = header[:1]
    (length,) = struct.unpack("<I", header[1:])
    # A length this large means the stream has desynced, and guessing past that is worse than
    # stopping: every read after it would be garbage.
    if length > MAX_PAYLOAD:
        log(f"stdin desynced (payload length {length}), stopping")
        return None
    payload = read_exact(stream, length) if length else b""
    if payload is None:
        return None
    return kind, payload


def dbfs(frame: np.ndarray) -> float:
    """RMS level of one frame, in dBFS. A full-scale sine reads about -3, speech -35 to -15, and a
    quiet room -60 to -45 - which is what the default threshold is set against."""
    if frame.size == 0:
        return -100.0
    rms = float(np.sqrt(np.mean(np.square(frame.astype(np.float32)))))
    if rms <= 0.0:
        return -100.0
    return max(-100.0, min(0.0, 20.0 * math.log10(rms / 32768.0)))


def clean(text: str) -> str:
    text = WAKE_PHRASE_RE.sub("", text).strip()
    if text.lower() in HALLUCINATIONS:
        return ""
    # Punctuation on its own is what a pause transcribes to.
    if not any(char.isalnum() for char in text):
        return ""
    return text


class State:
    """What the commands set. Only the read thread touches this, so it needs no lock."""

    def __init__(self) -> None:
        self.listening = False
        self.metering = False
        self.silence_db = DEFAULT_SILENCE_DB
        self.silence_ms = DEFAULT_SILENCE_MS

    def silence_samples(self) -> int:
        return max(self.silence_ms, MIN_SILENCE_MS) * SAMPLE_RATE // 1000

    def apply(self, payload: bytes) -> None:
        try:
            message = json.loads(payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            log(f"bad command: {error}")
            return
        if not isinstance(message, dict):
            return

        command = message.get("cmd")
        if command == "listen":
            self.listening = bool(message.get("on"))
        elif command == "meter":
            self.metering = bool(message.get("on"))
        elif command == "config":
            silence_db = message.get("silenceDb")
            silence_ms = message.get("silenceMs")
            if isinstance(silence_db, (int, float)):
                self.silence_db = float(silence_db)
            if isinstance(silence_ms, (int, float)):
                self.silence_ms = int(silence_ms)
        # Anything else is ignored, so a newer app can talk to an older script.


def transcribe(whisper_model: WhisperModel, audio: np.ndarray) -> str:
    audio_float = audio.astype(np.float32) / 32768.0
    segments, _ = whisper_model.transcribe(
        audio_float, language="en", beam_size=1, vad_filter=True, without_timestamps=True
    )
    text = " ".join(segment.text.strip() for segment in segments)
    return text.replace("\n", " ").strip()


def transcribe_loop(whisper_model: WhisperModel, work: queue.Queue) -> None:
    """Drains the queue in order, which is what puts a phrase's SEGMENT ahead of the SILENCE that
    closed it - the read loop enqueues both and waits for neither."""
    while True:
        kind, payload = work.get()
        if kind == "stop":
            return
        if kind == "silence":
            emit("SILENCE")
            continue
        try:
            text = clean(transcribe(whisper_model, payload))
        except Exception as error:  # a failed phrase must not take the thread down with it
            log(f"transcribe failed: {error}")
            continue
        if text:
            emit(f"SEGMENT {text}")


def main() -> None:
    _lower_process_priority()
    model = WakeWordModel(models=[str(MODEL_PATH)])
    # cpu_threads is capped because CTranslate2 otherwise takes every core, and the two it would
    # take them from are this process's own read loop and the Electron UI.
    whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8", cpu_threads=2)

    work: queue.Queue = queue.Queue()
    consumer = threading.Thread(target=transcribe_loop, args=(whisper_model, work), daemon=True)
    consumer.start()
    emit("READY")

    state = State()

    wake_buffer = np.zeros(0, dtype=np.int16)
    samples_since_step = 0
    samples_since_detection = DEBOUNCE_SAMPLES

    phrase: list[np.ndarray] = []
    phrase_samples = 0
    voiced_samples = 0
    in_speech = False
    silence_run = 0
    # `had_speech` and `latched` together mean one SILENCE per speech-then-quiet, and none at all
    # for a room nobody is talking in - which is what stops voice mode sending an empty composer.
    had_speech = False
    latched = True

    def reset_capture() -> None:
        nonlocal phrase, phrase_samples, voiced_samples, in_speech, silence_run, had_speech, latched
        phrase = []
        phrase_samples = 0
        voiced_samples = 0
        in_speech = False
        silence_run = 0
        had_speech = False
        latched = True

    def flush_phrase() -> None:
        nonlocal phrase, phrase_samples, voiced_samples
        if phrase and voiced_samples >= MIN_VOICED_SAMPLES:
            work.put(("audio", np.concatenate(phrase)))
        phrase = []
        phrase_samples = 0
        voiced_samples = 0

    stdin = sys.stdin.buffer
    while True:
        message = read_message(stdin)
        if message is None:
            break
        kind, payload = message

        if kind == TYPE_COMMAND:
            was_listening = state.listening
            state.apply(payload)
            # Switching off drops whatever was half-said: it belongs to a mode that is over.
            if was_listening and not state.listening:
                reset_capture()
            continue

        if kind != TYPE_AUDIO or len(payload) < 2:
            continue

        frame = np.frombuffer(payload[: len(payload) & ~1], dtype=np.int16)

        # Wake inference runs whether or not we are listening, so that a second "hey livekit" can
        # switch voice mode back off mid-sentence.
        wake_buffer = np.concatenate([wake_buffer, frame])[-WINDOW_SAMPLES:]
        samples_since_step += frame.size
        samples_since_detection += frame.size

        if samples_since_step >= STEP_SAMPLES and wake_buffer.size >= WINDOW_SAMPLES:
            samples_since_step = 0
            score = model.predict(wake_buffer).get(MODEL_NAME, 0.0)
            if score > THRESHOLD and samples_since_detection >= DEBOUNCE_SAMPLES:
                samples_since_detection = 0
                emit(f"WAKE {score:.3f}")
                # The phrase is discarded rather than flushed. Flushing it would transcribe the wake
                # word itself, and on deactivation the text would arrive for a mode already off.
                # The window goes with it, so the same phrase cannot be heard twice.
                wake_buffer = np.zeros(0, dtype=np.int16)
                reset_capture()
                continue

        level = dbfs(frame)
        if state.metering:
            emit(f"LEVEL {level:.1f}")

        if not state.listening:
            continue

        if level > state.silence_db:
            in_speech = True
            had_speech = True
            latched = False
            silence_run = 0
            phrase.append(frame)
            phrase_samples += frame.size
            voiced_samples += frame.size
            if phrase_samples >= MAX_PHRASE_SAMPLES:
                # `in_speech` stays set: the countdown to sending has to measure from the moment
                # speech actually stops, not from this cut.
                flush_phrase()
            continue

        silence_run += frame.size
        # A little trailing quiet helps whisper find the end of the last word. Past the endpoint
        # there is nothing in it worth transcribing.
        if in_speech and silence_run <= PHRASE_ENDPOINT_SAMPLES:
            phrase.append(frame)
            phrase_samples += frame.size

        if in_speech and silence_run >= PHRASE_ENDPOINT_SAMPLES:
            flush_phrase()
            in_speech = False
            # `silence_run` is deliberately left running: the configured countdown is measured from
            # the end of speech, not from the end of the phrase.

        if not latched and had_speech and silence_run >= state.silence_samples():
            # Anything still open goes first, so what gets sent always includes the last phrase -
            # however the two durations happen to be configured relative to each other.
            flush_phrase()
            work.put(("silence", None))
            latched = True
            had_speech = False

    work.put(("stop", None))
    consumer.join(timeout=2.0)


if __name__ == "__main__":
    main()
