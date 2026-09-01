/* How often the sidebar's "5 minutes ago" labels are recomputed, and how often project titles are
   re-read from Notion.

   Chat timestamps are read from Notion at startup and moved forward locally on each send — the tick
   only decides how promptly those labels catch up with the clock. Project titles do go to the
   network: a rename in Notion is otherwise invisible until the next launch.

   Stored in localStorage rather than Notion: it is a per-machine preference about refresh frequency,
   not something a chat carries with it. */

const STORAGE_KEY = 'spline.pollIntervalSeconds'

export const MIN_POLL_SECONDS = 30
export const MAX_POLL_SECONDS = 60 * 60
export const DEFAULT_POLL_SECONDS = 60

export function clampPollSeconds(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_POLL_SECONDS
    return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(value)))
}

export function loadPollSeconds(): number {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw === null ? DEFAULT_POLL_SECONDS : clampPollSeconds(Number(raw))
    } catch {
        /* Storage can throw outright when site data is blocked — the default is a fine answer. */
        return DEFAULT_POLL_SECONDS
    }
}

export function savePollSeconds(value: number): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, String(clampPollSeconds(value)))
    } catch {
        /* A preference that cannot be remembered still applies for this run. */
    }
}

/** "30 seconds", "5 minutes", "1 hour" — the slider's readout. */
export function formatPollSeconds(seconds: number): string {
    if (seconds < 60) return `${seconds} seconds`
    if (seconds < 60 * 60) {
        const minutes = Math.round(seconds / 60)
        return `${minutes} minute${minutes === 1 ? '' : 's'}`
    }
    return '1 hour'
}
