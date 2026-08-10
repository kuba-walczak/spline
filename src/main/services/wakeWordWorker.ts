import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { PvRecorder } from '@picovoice/pvrecorder-node'

// Runs as its own forked process (see WakeWordService.ts) so that PvRecorder's
// blocking native read() call never stalls the Electron main thread / UI.

const FRAME_LENGTH = 1600 // 100ms at 16kHz

let recorder: PvRecorder | null = null
let pythonProcess: ChildProcessWithoutNullStreams | null = null
let running = true

function start(): void {
    const scriptPath = join(__dirname, '../../python/wakeword_listener.py')
    pythonProcess = spawn('python', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] })
    pythonProcess.stdout.setEncoding('utf8')

    let buffer = ''
    pythonProcess.stdout.on('data', (chunk: string) => {
        buffer += chunk
        let newlineIndex: number
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex).trim()
            buffer = buffer.slice(newlineIndex + 1)
            if (line.startsWith('WAKE')) {
                process.send?.({ type: 'wake' })
            } else if (line.startsWith('TRANSCRIPT')) {
                process.send?.({ type: 'transcript', text: line.slice('TRANSCRIPT'.length).trim() })
            }
        }
    })

    pythonProcess.stderr.setEncoding('utf8')
    pythonProcess.stderr.on('data', (chunk: string) => console.error('[wakeword]', chunk))

    pythonProcess.on('exit', (code) => {
        console.error(`[wakeword] python process exited with code ${code}`)
        pythonProcess = null
    })

    try {
        recorder = new PvRecorder(FRAME_LENGTH, -1)
        recorder.start()
        void loop()
    } catch (error) {
        console.error('[wakeword] failed to start mic recorder:', (error as Error).message)
        running = false
    }
}

async function loop(): Promise<void> {
    while (running && recorder && pythonProcess) {
        const frame = await recorder.read()
        pythonProcess.stdin.write(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength))
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

process.on('message', (message: { type: string }) => {
    if (message.type === 'stop') stop()
})

start()
