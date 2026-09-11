/* Which chats keep the name they have, per chat.

   A locked chat is skipped by the haiku re-title pass that otherwise runs after every message, so a
   name written by hand survives the next send. localStorage rather than the chat's Notion row for
   the same reason the active skills are: the chat database has no column for it, and this is a
   toggle about how this machine treats a conversation. Keyed by session id, which is stable for the
   life of the chat. */

const PREFIX = 'spline.titleLock.'

/** Every locked session, read in one pass so the chat list does not hit storage per row. */
export function loadTitleLocks(): Record<string, boolean> {
    const locks: Record<string, boolean> = {}
    try {
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i)
            if (key?.startsWith(PREFIX)) locks[key.slice(PREFIX.length)] = true
        }
    } catch {
        /* Unreadable or blocked storage means nothing is locked — titles refresh as they did before
           the toggle existed. */
    }
    return locks
}

export function saveTitleLock(sessionId: string, locked: boolean): void {
    if (!sessionId) return
    try {
        if (locked) window.localStorage.setItem(PREFIX + sessionId, '1')
        else window.localStorage.removeItem(PREFIX + sessionId)
    } catch {
        /* A lock that cannot be remembered still holds for this run. */
    }
}
