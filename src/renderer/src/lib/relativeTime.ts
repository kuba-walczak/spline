/* "5 seconds ago", "5 days ago" — the sidebar's last-active labels.

   Written out rather than handed to Intl.RelativeTimeFormat because that formats a single unit you
   have to pick yourself, which is the whole job; all it would replace is the pluralisation. */

const UNITS: Array<{ seconds: number; name: string }> = [
    { seconds: 60 * 60 * 24 * 365, name: 'year' },
    { seconds: 60 * 60 * 24 * 30, name: 'month' },
    { seconds: 60 * 60 * 24, name: 'day' },
    { seconds: 60 * 60, name: 'hour' },
    { seconds: 60, name: 'minute' },
    { seconds: 1, name: 'second' }
]

/** Empty for a missing timestamp, so a chat with no recorded activity simply shows nothing. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
    if (!iso) return ''

    const then = Date.parse(iso)
    if (Number.isNaN(then)) return ''

    /* Notion rounds `Last active` to the minute, so a chat written seconds ago can carry a stamp
       slightly in the future. Clamping keeps that from reading as a negative age. */
    const seconds = Math.max(0, Math.round((now - then) / 1000))
    if (seconds < 5) return 'just now'

    for (const unit of UNITS) {
        const count = Math.floor(seconds / unit.seconds)
        if (count >= 1) return `${count} ${unit.name}${count === 1 ? '' : 's'} ago`
    }

    return 'just now'
}
