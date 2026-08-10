"""Reads raw 16kHz int16 mono PCM from stdin.

Prints "WAKE <score>" on wake word detection, then accumulates the next 5s
of audio and prints "TRANSCRIPT <text>" once transcribed. While capturing,
wake word inference is skipped so it can't re-trigger mid-sentence.

Spawned as a child process by src/main/services/wakeWordWorker.ts, which owns
mic capture (via PvRecorder) and streams frames to this process's stdin.
"""

import ctypes
import sys
from pathlib import Path

import numpy as np
from faster_whisper import WhisperModel
from livekit.wakeword import WakeWordModel

SAMPLE_RATE = 16000
WINDOW_SAMPLES = SAMPLE_RATE * 2  # ~2s window, as recommended by WakeWordModel
STEP_SAMPLES = SAMPLE_RATE // 2  # run inference every 500ms of new audio
THRESHOLD = 0.5
DEBOUNCE_SAMPLES = SAMPLE_RATE * 2  # ignore repeat detections within 2s
CAPTURE_SAMPLES = SAMPLE_RATE * 5  # 5s command window after wake word

MODEL_NAME = "hey_livekit"
MODEL_PATH = Path(__file__).parent / "models" / f"{MODEL_NAME}.onnx"

BELOW_NORMAL_PRIORITY_CLASS = 0x00004000


def _lower_process_priority() -> None:
    # Keep ONNX/whisper inference from competing with the Electron UI thread for CPU.
    if sys.platform == "win32":
        kernel32 = ctypes.windll.kernel32
        kernel32.SetPriorityClass(kernel32.GetCurrentProcess(), BELOW_NORMAL_PRIORITY_CLASS)


def transcribe(whisper_model: WhisperModel, audio: np.ndarray) -> str:
    audio_float = audio.astype(np.float32) / 32768.0
    segments, _ = whisper_model.transcribe(audio_float, language="en", beam_size=1)
    text = " ".join(segment.text.strip() for segment in segments)
    return text.replace("\n", " ").strip()


def main() -> None:
    _lower_process_priority()
    model = WakeWordModel(models=[str(MODEL_PATH)])
    whisper_model = WhisperModel("tiny", device="cpu", compute_type="int8")

    buffer = np.zeros(0, dtype=np.int16)
    samples_since_step = 0
    samples_since_detection = DEBOUNCE_SAMPLES

    capturing = False
    capture_buffer = np.zeros(0, dtype=np.int16)

    stdin = sys.stdin.buffer
    while True:
        chunk = stdin.read(4096)
        if not chunk:
            break

        frame = np.frombuffer(chunk, dtype=np.int16)

        if capturing:
            capture_buffer = np.concatenate([capture_buffer, frame])
            if len(capture_buffer) >= CAPTURE_SAMPLES:
                text = transcribe(whisper_model, capture_buffer[:CAPTURE_SAMPLES])
                print(f"TRANSCRIPT {text}", flush=True)
                capturing = False
                capture_buffer = np.zeros(0, dtype=np.int16)
                samples_since_detection = 0
            continue

        buffer = np.concatenate([buffer, frame])[-WINDOW_SAMPLES:]
        samples_since_step += len(frame)
        samples_since_detection += len(frame)

        if samples_since_step < STEP_SAMPLES or len(buffer) < WINDOW_SAMPLES:
            continue
        samples_since_step = 0

        scores = model.predict(buffer)
        score = scores.get(MODEL_NAME, 0.0)

        if score > THRESHOLD and samples_since_detection >= DEBOUNCE_SAMPLES:
            print(f"WAKE {score:.3f}", flush=True)
            capturing = True
            capture_buffer = np.zeros(0, dtype=np.int16)


if __name__ == "__main__":
    main()
