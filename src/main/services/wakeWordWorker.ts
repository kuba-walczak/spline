import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { PvRecorder } from '@picovoice/pvrecorder-node'

// Runs as its own forked process (see WakeWordService.ts) so that PvRecorder's
// blocking native read() call never stalls the Electron main thread / UI.

const FRAME_LENGTH = 1600 // 100ms at 16kHz

/* One pipe carries both the audio and the commands that steer the listener, framed so the two can
   be told apart: a type byte, a little-endian uint32 length, then the payload. See the docstring in
   python/wakeword_listener.py for the other end of it. */
const TYPE_AUDIO = 0x41 // 'A'
const TYPE_COMMAND = 0x43 // 'C'

let recorder: PvRecorder | null = null
let pythonProcess: ChildProcessWithoutNullStreams | null = null
let running = true
/* Set when stdin's buffer is full. Audio written while it is set is dropped rather than queued:
   a frame that arrives late is worth nothing, and queueing them would grow this process's memory
   while pushing the wake word further and further behind the microphone. Commands are never
   dropped - they are rare, and one that goes missing leaves the listener in the wrong mode. */
let stdinFull = false

function frame(type: number, payload: Buffer): Buffer {
    const header = Buffer.allocUnsafe(5)
    header.writeUInt8(type, 0)
    header.writeUInt32LE(payload.length, 1)
    return Buffer.concat([header, payload])
}

function sendCommand(command: Record<string, unknown>): void {
    if (!pythonProcess) return
    pythonProcess.stdin.write(frame(TYPE_COMMAND, Buffer.from(JSON.stringify(command), 'utf8')))
}

function start(): void {
    const scriptPath = join(__dirname, '../../python/wakeword_listener.py')
    pythonProcess = spawn('python', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    pythonProcess.stdout.setEncoding('utf8')

    pythonProcess.stdin.on('drain', () => {
        stdinFull = false
    })
    /* Python exiting closes this, and writing to a closed pipe throws rather than erroring back. */
    pythonProcess.stdin.on('error', (error) => console.error('[wakeword] stdin:', error.message))

    let buffer = ''
    pythonProcess.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let newlineIndex: number
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim()
            buffer = buffer.slice(newlineIndex + 1)
            if (line === 'READY') {
                process.send?.({ type: 'ready' })
            } else if (line.startsWith('WAKE')) {
                process.send?.({ type: 'wake' })
            } else if (line.startsWith('LEVEL')) {
                const db = Number(line.slice('LEVEL'.length).trim())
                if (Number.isFinite(db)) process.send?.({ type: 'level', db })
            } else if (line.startsWith('SEGMENT')) {
                const text = line.slice('SEGMENT'.length).trim()
                if (text) process.send?.({ type: 'segment', text })
            } else if (line === 'SILENCE') {
                process.send?.({ type: 'silence' })
            }
            /* Anything else is ONNX or whisper talking to itself. */
        }
    })

    pythonProcess.stderr.setEncoding('utf8')
    pythonProcess.stderr.on('data', (chunk: string) => console.error('[wakeword]', chunk))

    pythonProcess.on('exit', (code) => {
        console.error(`[wakeword] python process exited with code ${code}`)
        pythonProcess = null
        /* Without the transcriber there is nothing left for this process to do, and exiting is what
           tells the main process the pipeline is gone - one failure path instead of two. */
        stop()
    })

    try {
        recorder = new PvRecorder(FRAME_LENGTH, -1)
        recorder.start()
        void loop()
    } catch (error) {
        console.error('[wakeword] failed to start mic recorder:', (error as Error).message)
        running = false
        stop()
    }
}

async function loop(): Promise<void> {
    while (running && recorder && pythonProcess) {
        const audio = await recorder.read()
        if (!running || !pythonProcess) break
        if (stdinFull) continue
        const payload = Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength)
        stdinFull = !pythonProcess.stdin.write(frame(TYPE_AUDIO, payload))
    }
}

function stop(): void {
    running = false
    recorder?.stop()
    recorder?.release()
    recorder = null
    pythonProcess?.kill()
    pythonProcess = null
    process.exit(0)
}

process.on(
    'message',
    (message: { type: string; on?: boolean; silenceDb?: number; silenceMs?: number }) => {
        if (message.type === 'stop') stop()
        else if (message.type === 'listen') sendCommand({ cmd: 'listen', on: message.on === true })
        else if (message.type === 'meter') sendCommand({ cmd: 'meter', on: message.on === true })
        else if (message.type === 'config') {
            sendCommand({ cmd: 'config', silenceDb: message.silenceDb, silenceMs: message.silenceMs })
        }
    }
)

start()
