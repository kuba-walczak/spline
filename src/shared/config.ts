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

/** The defaults, and what the app runs on until the page has been read. */
export const EMPTY_CONFIG: AppConfig = {
    title: '',
    system: '',
    affiliations: [],
    expandTools: DEFAULT_EXPAND_TOOLS,
    pollSeconds: DEFAULT_POLL_SECONDS
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
    const read = (key: 'title' | 'system'): string =>
        typeof record[key] === 'string' ? (record[key] as string) : ''

    return {
        title: read('title'),
        system: read('system'),
        affiliations: readAffiliations(record.affiliations),
        expandTools:
            typeof record.expandTools === 'boolean' ? record.expandTools : DEFAULT_EXPAND_TOOLS,
        pollSeconds:
            typeof record.pollSeconds === 'number' ? clampPollSeconds(record.pollSeconds) : DEFAULT_POLL_SECONDS
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
