import { fork, ChildProcess } from 'node:child_process'
import { join } from 'node:path'

// Mic capture runs in a separate forked process (wakeWordWorker.ts) since
// PvRecorder's read() call blocks the calling thread - forking keeps that
// off the Electron main thread so the UI never stalls.

let worker: ChildProcess | null = null

export interface WakeWordCallbacks {
    /** Both models are loaded and the pipeline is warm. Until this, nothing is being heard. */
    onReady: () => void
    /** The wake word. What it toggles is the renderer's business, not this module's. */
    onWake: () => void
    /** Input level in dBFS, ~10/s, only while metering is switched on. */
    onLevel: (db: number) => void
    /** One transcribed phrase. */
    onSegment: (text: string) => void
    /** The mic has been quiet for the configured duration, following speech. */
    onSilence: () => void
    /** The worker is gone - mic or python died. Nothing further arrives until the app restarts. */
    onExit: () => void
}

export function startWakeWordListener(callbacks: WakeWordCallbacks): void {
    if (worker) return

    const workerPath = join(__dirname, 'wakeWordWorker.js')
    /* stdout and stderr are inherited rather than ignored: this process relays python's stderr and
       reports its own failures - a mic that cannot open, most of all - and discarding both left
       every one of those silent. */
    worker = fork(workerPath, { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] })

    worker.on(
        'message',
        (message: { type: string; text?: string; db?: number }) => {
            if (message.type === 'ready') callbacks.onReady()
            else if (message.type === 'wake') callbacks.onWake()
            else if (message.type === 'level' && typeof message.db === 'number') {
                callbacks.onLevel(message.db)
            } else if (message.type === 'segment') callbacks.onSegment(message.text ?? '')
            else if (message.type === 'silence') callbacks.onSilence()
        }
    )

    worker.on('exit', (code) => {
        console.error(`[wakeword] worker process exited with code ${code}`)
        worker = null
        callbacks.onExit()
    })
}

/** Whether the listener is transcribing what it hears. Wake detection runs either way. */
export function setVoiceListening(on: boolean): void {
    worker?.send({ type: 'listen', on })
}

/** Whether level readings are being reported. Off by default - nobody is watching a meter. */
export function setVoiceMeter(on: boolean): void {
    worker?.send({ type: 'meter', on })
}

/** Pushed at startup and again whenever Settings is synced, so a threshold change lands without
    reloading the models. */
export function setVoiceConfig(silenceDb: number, silenceMs: number): void {
    worker?.send({ type: 'config', silenceDb, silenceMs })
}

export function stopWakeWordListener(): void {
    worker?.send({ type: 'stop' })
    worker = null
}
