/* How a project's context items are grouped.

   A folder is a real Notion page: a child page of the project whose title ends in "(folder)", and
   the context pages made inside it are its own child pages. So the grouping is Notion's own
   structure and nothing else has to remember it — opening the project in Notion shows the same
   folders holding the same pages, and renaming a folder there renames it here.

   The suffix is the whole of what makes a folder a folder. Notion's block list names a child page
   and gives nothing else away — no icon, no body, no type — so a title is the only thing that can
   be read without a request per page. It is also the only marker a person can see and set from
   inside Notion. The app hides it wherever a folder's name is shown, so "Research (folder)" reads
   as "Research" everywhere but Notion itself.

   The cost of a convention is that it can be triggered by accident: a context page named
   "Notes (folder)" is a folder, here and in Notion both. Renaming it is the undo.

   Chats, people and pages are not nested — a chat and a person are rows in their own tables, and a
   page is a row in Pages so that it can be in several projects or in none. A folder files those by
   linking to them from its own page, which is why a folder holds two kinds of member: the pages
   Notion still keeps inside it from before pages moved out, and everything it links to. */

/** What marks a child page as a folder. Matched case-insensitively and with any spacing, so a folder
    renamed by hand in Notion still reads as one. */
const FOLDER_SUFFIX = /\s*\(folder\)\s*$/i

export function isFolderTitle(title: string): boolean {
    return FOLDER_SUFFIX.test(title)
}

/** The name to show for a folder page: its title without the marker. */
export function folderName(title: string): string {
    return title.replace(FOLDER_SUFFIX, '').trim()
}

/** The title to give a folder page in Notion, for a name typed in the app. */
export function folderTitle(name: string): string {
    return `${name.trim() || 'Untitled'} (folder)`
}

import { normalizeNotionId } from './notionId'

export interface ContextFolder {
    /** The folder's own Notion page. */
    id: string
    /** Its page title. */
    name: string
    /** Context pages living inside the folder page, as Notion holds them. */
    pages: Array<{ id: string; title: string }>
    /** Chats and people filed here, by id — they live elsewhere in Notion, so the folder page
        records them instead of containing them. */
    items: string[]
}

/** Maps every id a folder holds — nested pages and recorded chats and people alike — to that
    folder. The first folder claiming an id wins: an id can only be in one place, and a duplicate in
    a hand-edited page would otherwise file it twice.

    Keyed by the id with its dashes stripped, because the ids arrive in both spellings: a block id
    comes dashed, an id read out of a link comes however Notion wrote it. Look up with
    `normalizeNotionId` or the answer is a miss, and a thing filed in a folder shows up outside it. */
export function folderByItemId(folders: ContextFolder[]): Map<string, ContextFolder> {
    const map = new Map<string, ContextFolder>()
    for (const folder of folders) {
        for (const id of folderMemberIds(folder)) {
            if (!map.has(id)) map.set(id, folder)
        }
    }
    return map
}

/** Everything a folder holds, pages first, in the order the panel shows them — normalised, so two
    spellings of the same id are one member. */
export function folderMemberIds(folder: ContextFolder): string[] {
    return folder.pages.map((p) => normalizeNotionId(p.id)).concat(folder.items.map(normalizeNotionId))
}
