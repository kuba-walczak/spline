/* How wide each column of a table is drawn.

   localStorage rather than Notion, and not by choice the way the other preferences here are: Notion
   stores a table's column widths but does not put them in the API, so there is no field on the page
   to write this to. It stays a per-machine note about presentation, and a table read on another
   machine comes back at its natural widths.

   Keyed by the page and the table's position within it rather than by the table's own block id.
   Saving a page rewrites its body, so every table comes back with a new id — widths keyed by id
   would be forgotten every time the page was edited, which is exactly when they matter. Position
   survives that, and only moves if the tables on a page are reordered. */

const PREFIX = 'spline.columnWidths.'

/** Narrower than this and a column is a sliver with nothing legible in it. */
export const MIN_COLUMN_WIDTH = 56

function key(pageId: string, tableIndex: number): string {
    return `${PREFIX}${pageId}.${tableIndex}`
}

/** The stored widths, or null for a table that has never been dragged.

    `columns` is what the table currently has: a stored row of a different length belongs to a table
    that has since gained or lost a column, and is dropped rather than applied to the wrong ones. */
export function loadColumnWidths(pageId: string, tableIndex: number, columns: number): number[] | null {
    try {
        const raw = window.localStorage.getItem(key(pageId, tableIndex))
        if (!raw) return null

        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed) || parsed.length !== columns) return null
        if (!parsed.every((width) => typeof width === 'number' && Number.isFinite(width) && width > 0)) {
            return null
        }

        return parsed as number[]
    } catch {
        /* Unreadable, blocked, or hand-edited into nonsense — the natural widths are a fine answer. */
        return null
    }
}

export function saveColumnWidths(pageId: string, tableIndex: number, widths: number[]): void {
    try {
        window.localStorage.setItem(key(pageId, tableIndex), JSON.stringify(widths))
    } catch {
        /* A width that cannot be remembered still holds for this run. */
    }
}

/** Back to sizing the columns by what is in them. */
export function clearColumnWidths(pageId: string, tableIndex: number): void {
    try {
        window.localStorage.removeItem(key(pageId, tableIndex))
    } catch {
        /* Nothing stored is the state being asked for anyway. */
    }
}
