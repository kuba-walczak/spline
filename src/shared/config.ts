import { isValidAffiliation } from './affiliations'

/* The app's settings, stored as a single JSON code block on the Config page in Notion.

   One block rather than a sub-page per setting: adding a field is a key in an object instead of a
   page to create, and reading the lot is one request rather than one per setting.

   Everything the Settings modal edits lives here, including the two preferences that used to sit in
   localStorage — a setting kept per machine is a setting that disagrees with itself on the next one,
   and the page is already the one place to look. */

export interface AppConfig {
    /** The prompt used to generate a chat's title. Empty disables re-titling. */
    title: string
    /** Appended to every chat's system prompt, ahead of any project context. */
    system: string
    /** The affiliations a person can be given, in the order they are offered. Edited in Settings →
        People; the People view only ever picks from this list. */
    affiliations: string[]
    /** Whether a tool group opens expanded. Groups can still be toggled one at a time. */
    expandTools: boolean
    /** How often last-active labels are recomputed and project titles are re-read from Notion. */
    pollSeconds: number
    /** The level, in dBFS, at or below which the mic counts as quiet. Voice mode measures silence
        against this: anything louder is speech, anything quieter starts the countdown to sending. */
    voiceSilenceDb: number
    /** How long the mic has to stay below `voiceSilenceDb` before voice mode sends what it heard. */
    voiceSilenceMs: number
    /** The voice replies are read in, by its `SpeechSynthesisVoice.name`. Empty picks one — see
        `pickVoice` in the renderer. A name is stored rather than an index because the list belongs
        to the machine, and this file is shared between them. */
    speechVoice: string
    /** How fast replies are read. 1 is the voice's own pace. */
    speechRate: number
}

export const DEFAULT_EXPAND_TOOLS = true

export const MIN_POLL_SECONDS = 30
export const MAX_POLL_SECONDS = 60 * 60
export const DEFAULT_POLL_SECONDS = 60

/** Holds the slider's range, and guards what a hand-edit of the page can set the interval to — a
    zero or a negative would be a timer firing as fast as the loop allows. */
export function clampPollSeconds(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_POLL_SECONDS
    return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(value)))
}

/* Both ends of the threshold are a slider that has stopped being useful: above -20 dBFS only a shout
   counts as speech, and below -80 the mic's own noise floor does. Speech runs about -35 to -15 dBFS
   and a quiet room about -60 to -45, which is where the default sits. */
export const MIN_VOICE_SILENCE_DB = -80
export const MAX_VOICE_SILENCE_DB = -20
export const DEFAULT_VOICE_SILENCE_DB = -45

/* The floor is kept clear of the pause that ends a phrase (700ms in wakeword_listener.py) so the
   send never races the transcription of what was just said. */
export const MIN_VOICE_SILENCE_MS = 800
export const MAX_VOICE_SILENCE_MS = 5000
export const DEFAULT_VOICE_SILENCE_MS = 1500

/** Guards the dB threshold the same way, and for the same reason: a hand-edit of the page reaches the
    listener, and a positive figure here is a mic that never hears anything. */
export function clampVoiceSilenceDb(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_VOICE_SILENCE_DB
    return Math.min(MAX_VOICE_SILENCE_DB, Math.max(MIN_VOICE_SILENCE_DB, Math.round(value)))
}

export function clampVoiceSilenceMs(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_VOICE_SILENCE_MS
    return Math.min(MAX_VOICE_SILENCE_MS, Math.max(MIN_VOICE_SILENCE_MS, Math.round(value)))
}

/* Either end of this is a voice that cannot be followed: below half speed the words come apart,
   and much above double the OS voices stop forming them at all. */
export const MIN_SPEECH_RATE = 0.5
export const MAX_SPEECH_RATE = 2
export const DEFAULT_SPEECH_RATE = 1

/** Rounded to the slider's step rather than to a whole number, which is what the other clamps do —
    the useful range here is narrow enough that whole numbers would leave three positions. */
export function clampSpeechRate(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_SPEECH_RATE
    return Math.min(MAX_SPEECH_RATE, Math.max(MIN_SPEECH_RATE, Math.round(value * 20) / 20))
}

/** The defaults, and what the app runs on until the page has been read. */
export const EMPTY_CONFIG: AppConfig = {
    title: '',
    system: '',
    affiliations: [],
    expandTools: DEFAULT_EXPAND_TOOLS,
    pollSeconds: DEFAULT_POLL_SECONDS,
    voiceSilenceDb: DEFAULT_VOICE_SILENCE_DB,
    voiceSilenceMs: DEFAULT_VOICE_SILENCE_MS,
    speechVoice: '',
    speechRate: DEFAULT_SPEECH_RATE
}

/** Reads the stored JSON into the shape the app expects. Unknown keys are ignored and missing ones
    come back at their default, so a field the page has not been given yet simply does nothing. */
export function parseConfig(raw: string): AppConfig {
    if (!raw.trim()) return { ...EMPTY_CONFIG, affiliations: [] }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config JSON must be an object')
    }

    const record = parsed as Record<string, unknown>
    const read = (key: 'title' | 'system' | 'speechVoice'): string =>
        typeof record[key] === 'string' ? (record[key] as string) : ''

    return {
        title: read('title'),
        system: read('system'),
        affiliations: readAffiliations(record.affiliations),
        expandTools:
            typeof record.expandTools === 'boolean' ? record.expandTools : DEFAULT_EXPAND_TOOLS,
        pollSeconds:
            typeof record.pollSeconds === 'number' ? clampPollSeconds(record.pollSeconds) : DEFAULT_POLL_SECONDS,
        voiceSilenceDb:
            typeof record.voiceSilenceDb === 'number'
                ? clampVoiceSilenceDb(record.voiceSilenceDb)
                : DEFAULT_VOICE_SILENCE_DB,
        voiceSilenceMs:
            typeof record.voiceSilenceMs === 'number'
                ? clampVoiceSilenceMs(record.voiceSilenceMs)
                : DEFAULT_VOICE_SILENCE_MS,
        speechVoice: read('speechVoice'),
        speechRate:
            typeof record.speechRate === 'number' ? clampSpeechRate(record.speechRate) : DEFAULT_SPEECH_RATE
    }
}

/* Hand-edited in Notion as often as it is written from here, so anything that is not a usable name
   is dropped rather than allowed to reach the People view as a blank or duplicate row. */
function readAffiliations(value: unknown): string[] {
    if (!Array.isArray(value)) return []

    const seen = new Set<string>()
    const out: string[] = []

    for (const entry of value) {
        if (typeof entry !== 'string' || !isValidAffiliation(entry)) continue
        const name = entry.trim()
        if (seen.has(name.toLowerCase())) continue
        seen.add(name.toLowerCase())
        out.push(name)
    }

    return out
}

/** Serializes back, indented, since a person edits this block by hand in Notion. */
export function serializeConfig(config: AppConfig): string {
    return JSON.stringify(config, null, 2)
}
