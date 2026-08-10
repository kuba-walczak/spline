import { fork, ChildProcess } from 'node:child_process'
import { join } from 'node:path'

// Mic capture runs in a separate forked process (wakeWordWorker.ts) since
// PvRecorder's read() call blocks the calling thread - forking keeps that
// off the Electron main thread so the UI never stalls.

let worker: ChildProcess | null = null

export interface WakeWordCallbacks {
    onWake: () => void
    onTranscript: (text: string) => void
}

export function startWakeWordListener(callbacks: WakeWordCallbacks): void {
    if (worker) return

    const workerPath = join(__dirname, 'wakeWordWorker.js')
    worker = fork(workerPath, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })

    worker.on('message', (message: { type: string; text?: string }) => {
        if (message.type === 'wake') callbacks.onWake()
        else if (message.type === 'transcript') callbacks.onTranscript(message.text ?? '')
    })

    worker.on('exit', (code) => {
        console.error(`[wakeword] worker process exited with code ${code}`)
        worker = null
    })
}

export function stopWakeWordListener(): void {
    worker?.send({ type: 'stop' })
    worker = null
}
