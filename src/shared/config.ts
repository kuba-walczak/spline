/* The app's settings, stored as a single JSON code block on the Config page in Notion.

   One block rather than a sub-page per setting: adding a field is a key in an object instead of a
   page to create, and reading the lot is one request rather than one per setting. */

export interface AppConfig {
    /** The prompt used to generate a chat's title. Empty disables re-titling. */
    title: string
    /** Appended to every chat's system prompt, ahead of any project context. */
    system: string
}

export const EMPTY_CONFIG: AppConfig = { title: '', system: '' }

/** Reads the stored JSON into the shape the app expects. Unknown keys are ignored and missing ones
    come back empty, so a field the page has not been given yet simply does nothing. */
export function parseConfig(raw: string): AppConfig {
    if (!raw.trim()) return { ...EMPTY_CONFIG }

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config JSON must be an object')
    }

    const record = parsed as Record<string, unknown>
    const read = (key: keyof AppConfig): string => (typeof record[key] === 'string' ? (record[key] as string) : '')

    return { title: read('title'), system: read('system') }
}

/** Serializes back, indented, since a person edits this block by hand in Notion. */
export function serializeConfig(config: AppConfig): string {
    return JSON.stringify(config, null, 2)
}
