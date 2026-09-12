/* What the voice listener reports to the renderer. One channel rather than one per kind, because
   these are one stream and the order within it carries meaning: the `segment` holding the last
   phrase arrives before the `silence` that sends it. */
export type VoiceEvent =
    /** Whether the listener is transcribing, and whether the pipeline is there to do it at all.
        Sent unprompted when the main process switches listening off on the renderer's behalf — a
        reload, a closed window, a dead worker — so the buttons cannot sit lit over nothing. */
    | { kind: 'status'; listening: boolean; available: boolean }
    /** The wake word. Toggles voice mode; what that means is the renderer's to decide. */
    | { kind: 'wake' }
    /** Input level in dBFS, ~10/s, only while a meter is switched on. */
    | { kind: 'level'; db: number }
    /** One transcribed phrase, to append to the composer. */
    | { kind: 'segment'; text: string }
    /** Speech has been followed by the configured quiet. Voice mode sends; dictation ignores it. */
    | { kind: 'silence' }
