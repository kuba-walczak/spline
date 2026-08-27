/* Whether a tool group starts expanded.

   Per-machine and about presentation only, so it lives in localStorage rather than Notion — the
   same reasoning as the poll interval. Groups can still be toggled individually; this only decides
   what they open as. */

const STORAGE_KEY = 'jarvis.expandTools'

export const DEFAULT_EXPAND_TOOLS = true

export function loadExpandTools(): boolean {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw === null ? DEFAULT_EXPAND_TOOLS : raw === 'true'
    } catch {
        /* Storage can throw outright when site data is blocked — the default is a fine answer. */
        return DEFAULT_EXPAND_TOOLS
    }
}

export function saveExpandTools(value: boolean): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
        /* A preference that cannot be remembered still applies for this run. */
    }
}
