/* Comparing Notion ids as plain strings is not safe: the API hands back dashed uuids, the ids
   hardcoded in this app are written without dashes, and either form can arrive from a URL a user
   pasted. Everything that matches one id against another goes through here. */

/** Both id forms reduced to the same 32 hex characters. */
export function normalizeNotionId(value: string): string {
    return value.replace(/-/g, '').toLowerCase()
}

/** Whether a string is a Notion id at all — the test that tells a chat row's project id apart from
    the project title those rows used to hold. A title is only mistaken for an id if it happens to be
    32 hex characters and nothing else. */
export function isNotionId(value: string): boolean {
    return /^[0-9a-f]{32}$/.test(normalizeNotionId(value.trim()))
}

export function sameNotionId(a: string, b: string): boolean {
    return normalizeNotionId(a) === normalizeNotionId(b)
}
