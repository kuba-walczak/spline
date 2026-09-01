/* How the project's Context panel lays its items out: the block grid or the compact list.

   Per-machine and about presentation only, so it lives in localStorage rather than Notion — the
   same reasoning as the tool-group expansion. One setting for every project, since it is a reading
   preference rather than something about a particular project. */

const STORAGE_KEY = 'spline.contextView'
const GROUPING_KEY = 'spline.contextGrouping'

export type ContextViewMode = 'grid' | 'list'

export const DEFAULT_CONTEXT_VIEW: ContextViewMode = 'grid'

export function loadContextView(): ContextViewMode {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw === 'list' || raw === 'grid' ? raw : DEFAULT_CONTEXT_VIEW
    } catch {
        /* Storage can throw outright when site data is blocked — the default is a fine answer. */
        return DEFAULT_CONTEXT_VIEW
    }
}

export function saveContextView(value: ContextViewMode): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
        /* A preference that cannot be remembered still applies for this run. */
    }
}

/* Whether the panel splits its items into a section per kind — folders, Notion pages, chats,
   people — or lays them out as one run. The same sort of preference as the view above: about
   reading rather than about the project, so it lives beside it and applies to every project. */

export const DEFAULT_CONTEXT_GROUPING = false

export function loadContextGrouping(): boolean {
    try {
        const raw = window.localStorage.getItem(GROUPING_KEY)
        return raw === null ? DEFAULT_CONTEXT_GROUPING : raw === 'true'
    } catch {
        return DEFAULT_CONTEXT_GROUPING
    }
}

export function saveContextGrouping(value: boolean): void {
    try {
        window.localStorage.setItem(GROUPING_KEY, String(value))
    } catch {
        /* A preference that cannot be remembered still applies for this run. */
    }
}

/* Whether a sidebar section groups its rows by project or lists them flat. The same sort of
   preference as the two above — about reading rather than about any one row — so it lives beside
   them, and each section remembers its own answer under its own key. */

export type GroupableSection = 'chats' | 'pages' | 'people'

const groupingKey = (section: GroupableSection): string => `spline.${section}Grouping`

export const DEFAULT_SECTION_GROUPING = false

export function loadSectionGrouping(section: GroupableSection): boolean {
    try {
        const raw = window.localStorage.getItem(groupingKey(section))
        return raw === null ? DEFAULT_SECTION_GROUPING : raw === 'true'
    } catch {
        return DEFAULT_SECTION_GROUPING
    }
}

export function saveSectionGrouping(section: GroupableSection, value: boolean): void {
    try {
        window.localStorage.setItem(groupingKey(section), String(value))
    } catch {
        /* A preference that cannot be remembered still applies for this run. */
    }
}
