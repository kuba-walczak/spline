/* The refresh interval's readout. The value itself, its bounds and its default live in the app
   config — it is stored on the Config page in Notion with every other setting (see shared/config). */

/** "30 seconds", "5 minutes", "1 hour" — the slider's readout. */
export function formatPollSeconds(seconds: number): string {
    if (seconds < 60) return `${seconds} seconds`
    if (seconds < 60 * 60) {
        const minutes = Math.round(seconds / 60)
        return `${minutes} minute${minutes === 1 ? '' : 's'}`
    }
    return '1 hour'
}
