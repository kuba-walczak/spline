/* Which persistent skills are switched on, per chat.

   localStorage rather than the chat's Notion row: the chat database has no column for it, and a
   toggle about how this machine talks to a conversation is not something the row is for. Keyed by
   session id, which is stable for the life of the chat. */

const KEY = (sessionId: string): string => `spline.activeSkills.${sessionId}`

export function loadActiveSkills(sessionId: string): string[] {
    if (!sessionId) return []
    try {
        const raw = window.localStorage.getItem(KEY(sessionId))
        if (!raw) return []
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    } catch {
        /* Unreadable or blocked storage means no skills are on — the safe reading, since the
           alternative is silently applying instructions nobody can see. */
        return []
    }
}

export function saveActiveSkills(sessionId: string, names: string[]): void {
    if (!sessionId) return
    try {
        if (names.length === 0) window.localStorage.removeItem(KEY(sessionId))
        else window.localStorage.setItem(KEY(sessionId), JSON.stringify(names))
    } catch {
        /* A toggle that cannot be remembered still applies for this run. */
    }
}
