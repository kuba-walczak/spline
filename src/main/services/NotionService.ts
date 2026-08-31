import 'dotenv/config'
import { readSessionTranscript } from './SessionTranscript'
import { CONTEXT_SEPARATOR } from '../../shared/injection'
import { folderByItemId, folderMemberIds, folderName, folderTitle, isFolderTitle } from '../../shared/context'
import type { ContextFolder } from '../../shared/context'
import { EMPTY_CONFIG, parseConfig, serializeConfig, type AppConfig } from '../../shared/config'
import { blocksToMarkdown, markdownToBlocks, type MarkdownBlock } from '../../shared/markdown'
import { EMPTY_SKILL_DATA, type Skill, type SkillData } from '../../shared/skills'
import { isNotionId, normalizeNotionId, sameNotionId } from '../../shared/notionId'

const NOTION_VERSION = '2025-09-03'
const CHATS_DATA_SOURCE_ID = 'efe919c7-c9c1-404e-ac41-2b5210790815'
const PROJECTS_DATA_SOURCE_ID = '7eb6fcf9-76ed-442b-9d7d-f1f9f080fd61'
const CONFIG_PAGE_ID = '3c6b837d9c31801a9e5df548713eca5e'
const SKILLS_DATA_SOURCE_ID = 'c8f643fe-0b2a-493f-ada2-4a6a3bd28f52'
const PEOPLE_DATA_SOURCE_ID = '0eff794f-7f39-4512-a555-1e41c5b9d639'
const PAGES_DATA_SOURCE_ID = 'a89568c7-dbde-4f35-a3bc-e00069de3775'

function headers(): Record<string, string> {
    const apiKey = process.env.NOTION_API_KEY
    if (!apiKey) throw new Error('NOTION_API_KEY is not set (add it to .env)')

    return {
        Authorization: `Bearer ${apiKey}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
    }
}

interface NotionRichText {
    plain_text: string
    type?: string
    /** A page mention: what "@" produces, and one of the two ways a project names something that
        cannot be a child page of it. */
    mention?: { type?: string; page?: { id: string } }
}

function plainText(richText: NotionRichText[] | undefined): string {
    return (richText ?? []).map((t) => t.plain_text).join('')
}

export interface ChatLogEntry {
    id: string
    name: string
    lastActive: string | null
    /** Which projects this chat belongs to, as project page ids. Rows last written before the app
        moved off titles hold the project's title instead — see `projectRefs`. */
    projectRefs: string[]
    /** The CLI session id whose transcript holds this chat. Null only for rows written before
        the app moved to session-backed chats — those have no recoverable history. */
    sessionId: string | null
    /** Per-chat model and effort. Null falls back to the app defaults. */
    model: string | null
    effort: string | null
    /** The row's own last edit. Moves on a rename or a project change as well as on a message,
        where `lastActive` only tracks the last message — which is why the staleness check reads
        this one and the sidebar reads that one. */
    lastEdited: string | null
}

/** Reads a property that may be stored as either a select or a text field, so the Chats
    columns work however they were set up in Notion. */
function scalarProperty(page: NotionPage, name: string): string | null {
    const prop = page.properties[name] as
        | { select?: { name: string } | null; rich_text?: NotionRichText[]; title?: NotionRichText[] }
        | undefined
    const value = prop?.select?.name ?? plainText(prop?.rich_text ?? prop?.title)
    return value?.trim() ? value.trim() : null
}

/** A page's title, wherever it keeps it. A row in a database calls the property whatever the column
    is called — "Name" in both Chats and Projects — and a plain page calls it "title". Found
    by type rather than by name, so one reader covers a project row and a context page alike. */
function pageTitle(properties: Record<string, unknown> | undefined): string {
    for (const value of Object.values(properties ?? {})) {
        const prop = value as { type?: string; title?: NotionRichText[] }
        if (prop?.type === 'title' || prop?.title) return plainText(prop.title)
    }
    return ''
}

/** Notion rejects a value shaped for the wrong property type, so the payload is built from the
    data source's own schema rather than assumed. Fetched once and cached. */
let propertyTypes: Record<string, string> | null = null

async function fetchPropertyTypes(): Promise<Record<string, string>> {
    if (propertyTypes) return propertyTypes

    const res = await fetch(`https://api.notion.com/v1/data_sources/${CHATS_DATA_SOURCE_ID}`, {
        headers: headers()
    })
    if (!res.ok) throw new Error(`Notion data source fetch failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { properties?: Record<string, { type?: string }> }
    propertyTypes = Object.fromEntries(
        Object.entries(data.properties ?? {}).map(([key, value]) => [key, value.type ?? 'rich_text'])
    )
    return propertyTypes
}

async function scalarPayload(name: string, value: string): Promise<Record<string, unknown>> {
    const type = (await fetchPropertyTypes())[name]
    if (type === 'select') return { select: { name: value } }
    if (type === 'multi_select') return { multi_select: [{ name: value }] }
    return { rich_text: [{ type: 'text', text: { content: value } }] }
}

/** Stores the model chosen for one chat, so reopening it restores that choice. */
export async function setChatModel(pageId: string, model: string): Promise<void> {
    await patchPage(pageId, { Model: await scalarPayload('Model', model) }, 'model')
}

/** Stores the effort level chosen for one chat. */
export async function setChatEffort(pageId: string, effort: string): Promise<void> {
    await patchPage(pageId, { Effort: await scalarPayload('Effort', effort) }, 'effort')
}

async function patchPage(pageId: string, properties: Record<string, unknown>, label: string): Promise<void> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ properties })
    })

    if (!res.ok) throw new Error(`Notion chat ${label} update failed: ${res.status} ${await res.text()}`)
}

interface NotionPage {
    id: string
    last_edited_time?: string
    properties: Record<string, unknown>
}

/** The raw values of the chat's "Project" tags — page ids now, titles on rows not written since.

    Read tolerantly, because the column has worn every shape Notion offers for this: it was a single
    select before it was a multi-select, and holding ids rather than names is a reason someone might
    yet turn it into a plain text field. */
function projectRefs(properties: Record<string, unknown>): string[] {
    const prop = properties.Project as
        | {
              multi_select?: Array<{ name: string }>
              select?: { name: string } | null
              rich_text?: NotionRichText[]
          }
        | undefined

    if (prop?.multi_select) return prop.multi_select.map((o) => o.name)
    if (prop?.select) return [prop.select.name]

    return plainText(prop?.rich_text)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
}

/** Whether a chat's tags claim it for this project. Anything that looks like an id is matched as
    one; anything else is a title left over from before the switch, and is matched by name so those
    rows keep working until something rewrites them. */
function linksToProject(refs: string[], projectId: string, projectTitle: string): boolean {
    return refs.some((ref) => (isNotionId(ref) ? sameNotionId(ref, projectId) : ref === projectTitle))
}

export async function fetchChatLog(): Promise<ChatLogEntry[]> {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${CHATS_DATA_SOURCE_ID}/query`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ sorts: [{ property: 'Last active', direction: 'descending' }] })
    })

    if (!res.ok) throw new Error(`Notion query failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { results: NotionPage[] }

    return data.results.map((page) => {
        const nameProp = page.properties.Name as { title?: NotionRichText[] } | undefined
        const lastActiveProp = page.properties['Last active'] as { date?: { start: string } } | undefined
        return {
            id: page.id,
            name: plainText(nameProp?.title),
            lastActive: lastActiveProp?.date?.start ?? null,
            projectRefs: projectRefs(page.properties),
            sessionId: scalarProperty(page, 'Session ID'),
            model: scalarProperty(page, 'Model'),
            effort: scalarProperty(page, 'Effort'),
            lastEdited: page.last_edited_time ?? null
        }
    })
}

/** Records which CLI session backs a chat — the id the app passes to `--resume` to continue it. */
export async function setChatSessionId(pageId: string, sessionId: string): Promise<void> {
    await patchPage(pageId, { 'Session ID': await scalarPayload('Session ID', sessionId) }, 'session id')
}

interface NotionBlock {
    id: string
    type: string
    last_edited_time?: string
    heading_1?: { rich_text: NotionRichText[] }
    heading_2?: { rich_text: NotionRichText[] }
    heading_3?: { rich_text: NotionRichText[] }
    paragraph?: { rich_text: NotionRichText[] }
    bulleted_list_item?: { rich_text: NotionRichText[] }
    numbered_list_item?: { rich_text: NotionRichText[] }
    to_do?: { rich_text: NotionRichText[]; checked?: boolean }
    quote?: { rich_text: NotionRichText[] }
    code?: { rich_text: NotionRichText[]; language?: string }
    child_page?: { title: string }
    link_to_page?: { type?: string; page_id?: string; database_id?: string }
    image?: {
        type: 'file' | 'external'
        file?: { url: string }
        external?: { url: string }
        caption?: NotionRichText[]
    }
    /* Reading one arm by name, for the walk over every kind of block that can hold a mention. */
    [key: string]: unknown
}

async function fetchBlockChildren(blockId: string): Promise<NotionBlock[]> {
    const results: NotionBlock[] = []
    let cursor: string | undefined

    do {
        const url = new URL(`https://api.notion.com/v1/blocks/${blockId}/children`)
        url.searchParams.set('page_size', '100')
        if (cursor) url.searchParams.set('start_cursor', cursor)

        const res = await fetch(url, { headers: headers() })
        if (!res.ok) throw new Error(`Notion block children failed: ${res.status} ${await res.text()}`)

        const data = (await res.json()) as { results: NotionBlock[]; has_more: boolean; next_cursor: string | null }
        results.push(...data.results)
        cursor = data.has_more ? (data.next_cursor ?? undefined) : undefined
    } while (cursor)

    return results
}

function toRichText(text: string): Array<{ type: 'text'; text: { content: string } }> {
    const chunks: string[] = []
    for (let i = 0; i < text.length; i += 1900) chunks.push(text.slice(i, i + 1900))
    if (chunks.length === 0) chunks.push('')
    return chunks.map((content) => ({ type: 'text', text: { content } }))
}

/** Replaces the Chats table's "Project" multi-select with one option per project page id.

    Ids rather than titles: the option name is the whole of the link, and renaming a project page in
    Notion leaves existing options and existing rows untouched — so a title here comes undone the
    moment the project is renamed, silently, while an id never moves. The cost is that the column
    reads as uuids in Notion. Writing a row is also what migrates it off titles. */
export async function setChatProjects(pageId: string, projectIds: string[]): Promise<void> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
            properties: { Project: { multi_select: projectIds.map((name) => ({ name })) } }
        })
    })

    if (!res.ok) throw new Error(`Notion chat project update failed: ${res.status} ${await res.text()}`)
}

/** Drops one project from a chat's "Project" tags, leaving the row itself and its other tags alone.
    The current set is read back from Notion rather than taken from the caller, so a chat tagged from
    somewhere else keeps those tags. The title is needed as well as the id because a row that has not
    been written since the switch still names the project rather than pointing at it. */
export async function detachChatFromProject(
    pageId: string,
    projectId: string,
    projectTitle: string
): Promise<void> {
    const page = await fetchPage(pageId)
    const current = projectRefs(page.properties ?? {})
    const next = current.filter((ref) => !linksToProject([ref], projectId, projectTitle))
    if (next.length === current.length) return

    await setChatProjects(pageId, next)
}

export async function createChatPage(
    name: string,
    sessionId: string,
    model: string,
    effort: string
): Promise<string> {
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            parent: { type: 'data_source_id', data_source_id: CHATS_DATA_SOURCE_ID },
            properties: {
                Name: { title: [{ type: 'text', text: { content: name } }] },
                'Last active': { date: { start: new Date().toISOString() } },
                'Session ID': await scalarPayload('Session ID', sessionId),
                Model: await scalarPayload('Model', model),
                Effort: await scalarPayload('Effort', effort)
            }
        })
    })

    if (!res.ok) throw new Error(`Notion page create failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { id: string }
    return data.id
}

export async function updatePageTitle(pageId: string, name: string): Promise<void> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
            properties: { Name: { title: [{ type: 'text', text: { content: name } }] } }
        })
    })

    if (!res.ok) throw new Error(`Notion page title update failed: ${res.status} ${await res.text()}`)
}

/** Archives (soft-deletes) the chat's row — Notion's DELETE for a page. */
export async function archiveChatPage(pageId: string): Promise<void> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ archived: true })
    })

    if (!res.ok) throw new Error(`Notion page archive failed: ${res.status} ${await res.text()}`)
}

export async function updateLastActive(pageId: string): Promise<void> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
            properties: { 'Last active': { date: { start: new Date().toISOString() } } }
        })
    })

    if (!res.ok) throw new Error(`Notion page update failed: ${res.status} ${await res.text()}`)
}

export interface ProjectEntry {
    id: string
    title: string
    lastEdited: string | null
    color: string | null
    /** What the project puts at the top of its chats' system prompt. */
    instructions: string
}

const HEX_COLOR = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/

interface NotionPageObject {
    last_edited_time?: string
    properties?: Record<string, unknown>
}

async function fetchPage(pageId: string): Promise<NotionPageObject> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: headers() })
    if (!res.ok) throw new Error(`Notion page fetch failed: ${res.status} ${await res.text()}`)
    return (await res.json()) as NotionPageObject
}

/** Every row of the Projects database — one card per project.

    One request for all of them. A project used to be a child page of a Projects page, with its
    colour and its instructions inside a "CLAUDE.md" page nested under it, so listing projects cost
    two more requests each: one for the page's own timestamp, one for its blocks, and the colour was
    only reachable by opening a page inside a page. As a row it carries all of that in its columns,
    and the list comes back whole. This runs on the refresh poll, which is what made that matter. */
export async function fetchProjects(): Promise<ProjectEntry[]> {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${PROJECTS_DATA_SOURCE_ID}/query`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({})
    })

    if (!res.ok) throw new Error(`Notion projects query failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { results: NotionPage[] }

    return data.results.map((page) => {
        const color = scalarProperty(page, 'Color')
        return {
            id: page.id,
            title: pageTitle(page.properties),
            lastEdited: page.last_edited_time ?? null,
            /* A colour hand-typed into the column as something other than a hex value is no colour
               at all, and the panel falls back to its default rather than writing `background:
               red;` from whatever was in there. */
            color: color && HEX_COLOR.test(color) ? color : null,
            instructions: scalarProperty(page, 'Instructions') ?? ''
        }
    })
}

export async function createProjectPage(title: string): Promise<string> {
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            parent: { type: 'data_source_id', data_source_id: PROJECTS_DATA_SOURCE_ID },
            properties: { Name: { title: [{ type: 'text', text: { content: title } }] } }
        })
    })

    if (!res.ok) throw new Error(`Notion project create failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { id: string }
    return data.id
}

/** Archiving a project archives its page, the same soft delete a chat, skill or person gets. The
    chats that referenced it keep their reference: a row points at a project by id, and a project
    that is gone simply stops resolving. */
export async function archiveProject(pageId: string): Promise<void> {
    await archiveChatPage(pageId)
}

/** Renames a project, which is renaming its row: the title lives in the "Name" column. Plain pages
    keep theirs under `title` instead — see `updatePlainPageTitle`. */
export async function updateProjectTitle(pageId: string, title: string): Promise<void> {
    await updatePageTitle(pageId, title)
}

/** Renames a page that is not a row — a folder, a context page, a person. */
export async function updatePlainPageTitle(pageId: string, title: string): Promise<void> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
            properties: { title: { title: [{ type: 'text', text: { content: title } }] } }
        })
    })

    if (!res.ok) throw new Error(`Notion project title update failed: ${res.status} ${await res.text()}`)
}

const DETAIL_BLOCK_TYPES = [
    'heading_1',
    'heading_2',
    'heading_3',
    'paragraph',
    'bulleted_list_item',
    'numbered_list_item',
    'to_do',
    'quote',
    'code',
    'divider',
    'child_page',
    'image'
] as const

export interface ProjectDetailBlock {
    id: string
    type: (typeof DETAIL_BLOCK_TYPES)[number]
    text: string
    checked?: boolean
    url?: string
}

function toDetailBlock(block: NotionBlock): ProjectDetailBlock | null {
    if (!(DETAIL_BLOCK_TYPES as readonly string[]).includes(block.type)) return null

    switch (block.type) {
        case 'heading_1':
            return { id: block.id, type: 'heading_1', text: plainText(block.heading_1?.rich_text) }
        case 'heading_2':
            return { id: block.id, type: 'heading_2', text: plainText(block.heading_2?.rich_text) }
        case 'heading_3':
            return { id: block.id, type: 'heading_3', text: plainText(block.heading_3?.rich_text) }
        case 'bulleted_list_item':
            return { id: block.id, type: 'bulleted_list_item', text: plainText(block.bulleted_list_item?.rich_text) }
        case 'numbered_list_item':
            return { id: block.id, type: 'numbered_list_item', text: plainText(block.numbered_list_item?.rich_text) }
        case 'to_do':
            return {
                id: block.id,
                type: 'to_do',
                text: plainText(block.to_do?.rich_text),
                checked: block.to_do?.checked ?? false
            }
        case 'quote':
            return { id: block.id, type: 'quote', text: plainText(block.quote?.rich_text) }
        case 'code':
            return { id: block.id, type: 'code', text: plainText(block.code?.rich_text) }
        case 'divider':
            return { id: block.id, type: 'divider', text: '' }
        case 'child_page':
            return { id: block.id, type: 'child_page', text: block.child_page?.title ?? '' }
        case 'image':
            /* The caption is the image's text: it is what the markdown writes as the alt, and the
               only part of a picture a person can edit here. */
            return {
                id: block.id,
                type: 'image',
                text: plainText(block.image?.caption),
                url: imageUrl(block)
            }
        default:
            return { id: block.id, type: 'paragraph', text: plainText(block.paragraph?.rich_text) }
    }
}

/** A page's blocks as a panel reads them, with a link to a page in the Pages table standing in for the
    page itself: the link becomes that page's `child_page` block, in the place the link sits. So a
    linked page and a page still nested from before arrive the same way, and nothing downstream has
    to know which is which. A link naming anything else — a chat, a person — is not a block at all
    and drops out here, as it did before there was anything to resolve it against. */
function toDetailBlocks(blocks: NotionBlock[], pages: PageEntry[]): ProjectDetailBlock[] {
    return blocks
        .map((block) => {
            if (block.type !== 'link_to_page') return toDetailBlock(block)

            const target = block.link_to_page?.page_id
            const page = target ? pageById(pages, target) : undefined
            return page ? { id: page.id, type: 'child_page' as const, text: page.title } : null
        })
        .filter((b): b is ProjectDetailBlock => b !== null)
}

/* Membership by reference: a project names what is in it, and holds none of it.

   Every one of them is a row in a table of its own — a page in Pages, a chat in Chats, a person in
   People. None of them is inside the project. Each belongs to it by being linked from it, as a
   `link_to_page` block or as an "@" mention in one of its own blocks. Both forms name a page id and
   neither moves anything, so the project page reads as one list of what is in the project, and
   dropping a link in or typing "@" in Notion is all it takes to add something by hand.

   Context pages used to belong by containment, as child pages of the project. That is why a page
   could be in one project only, why removing it from a project deleted it, and why moving it between
   folders had to copy it. A page still nested inside a project from back then is read as a member
   too (see `fetchProjectDetail`), so the two ways coexist and nothing had to be migrated at once.

   Mentions are read but never written: removing one means rewriting the sentence it sits in, so the
   app writes link blocks, which it can delete on their own. Only the page's own blocks are searched
   — a mention nested inside a toggle or a table is not membership, it is prose. */

/** Every page id a block links to, whether as a link block or as a mention inside its text. */
function linkedIds(block: NotionBlock): string[] {
    if (block.type === 'link_to_page') {
        return block.link_to_page?.type === 'page_id' && block.link_to_page.page_id
            ? [block.link_to_page.page_id]
            : []
    }

    return RICH_TEXT_KEYS.flatMap((key) =>
        (block[key]?.rich_text ?? [])
            .filter((t) => t.type === 'mention' && t.mention?.type === 'page' && t.mention.page?.id)
            .map((t) => t.mention?.page?.id as string)
    )
}

/** The blocks a mention can be written into. Headings and list items count: a person keeping their
    context under "## Research" is still saying it is in the project. */
const RICH_TEXT_KEYS = [
    'paragraph',
    'bulleted_list_item',
    'numbered_list_item',
    'to_do',
    'quote',
    'heading_1',
    'heading_2',
    'heading_3'
] as const

/** Everything a page links to, in the order it appears, with duplicates dropped. */
function linkedPageIds(blocks: NotionBlock[]): string[] {
    const seen = new Set<string>()

    for (const block of blocks) {
        for (const id of linkedIds(block)) seen.add(normalizeNotionId(id))
    }

    return Array.from(seen)
}

/* One row per piece of context in the Pages table.

   Pages live here rather than under the project they are about, so a page can be in several
   projects, in none at all, or outlive the project it was written for. What a project holds is the
   link, and unlinking leaves the page standing.

   The row is a name and nothing else so far — the page itself is the content. It is a table rather
   than a page of pages so that a fact wanted about every page can become a column, the way
   Affiliation did for people, without moving anything again. */

export interface PageEntry {
    id: string
    title: string
    /** For `fetchProjectVersion`: a linked page is not among the project's own blocks, so editing
        one would otherwise leave the project's stamp untouched. */
    lastEdited: string | null
}

/** Every page in the table. One request, and the only way a linked id gets a title — a link block
    names an id and nothing else. */
export async function fetchPages(): Promise<PageEntry[]> {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${PAGES_DATA_SOURCE_ID}/query`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({})
    })

    if (!res.ok) throw new Error(`Notion pages query failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { results: NotionPage[] }

    return data.results.map((page) => ({
        id: page.id,
        title: pageTitle(page.properties),
        lastEdited: page.last_edited_time ?? null
    }))
}

/** The page one id names, or undefined for an id that names something else — a chat, a person, a
    page deleted in Notion. Ids arrive in both spellings, hence `sameNotionId` over a map lookup. */
function pageById(pages: PageEntry[], id: string): PageEntry | undefined {
    return pages.find((page) => sameNotionId(page.id, id))
}

export interface ProjectChatEntry {
    id: string
    name: string
    sessionId: string | null
    lastEdited: string | null
}

export interface ProjectDetail {
    id: string
    title: string
    lastEdited: string | null
    instructions: string
    color: string | null
    blocks: ProjectDetailBlock[]
    chats: ProjectChatEntry[]
    /** People attached to this project, resolved from the ids it links to. */
    people: PersonEntry[]
    /** The project's folders, each one a child page of its own. The pages they hold are inside them
        in Notion and so are not among `blocks`; the chats and people they hold are. */
    folders: ContextFolder[]
}

function isInstructionsPage(block: NotionBlock): boolean {
    return block.type === 'child_page' && block.child_page?.title?.trim().toLowerCase() === 'claude.md'
}

export type { ContextFolder }

async function createChildPage(parentId: string, title: string): Promise<string> {
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            parent: { type: 'page_id', page_id: parentId },
            properties: { title: { title: [{ type: 'text', text: { content: title } }] } }
        })
    })

    if (!res.ok) throw new Error(`Notion child page create failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { id: string }
    return data.id
}

/** Turns one parsed block into the payload Notion wants. Every arm here has a markdown spelling in
    `blocksToMarkdown`, which is what keeps the round trip honest.

    Null for a block Notion cannot be given back: an image Notion is hosting itself is reachable only
    through a signed url that expires within the hour, so storing that url as an external image would
    write a link that dies. Those are kept as the blocks they already are — see `rewritePageBody` —
    and only reach here when their block is gone, at which point there is nothing to write. */
function toNotionBlock(block: MarkdownBlock): Record<string, unknown> | null {
    const rich_text = toRichText(block.text)

    switch (block.type) {
        case 'divider':
            return { object: 'block', type: 'divider', divider: {} }
        case 'to_do':
            return { object: 'block', type: 'to_do', to_do: { rich_text, checked: block.checked ?? false } }
        case 'code':
            /* Notion requires a language and validates it against a fixed list; the app does not
               carry one, so every fence is stored plain. */
            return { object: 'block', type: 'code', code: { rich_text, language: 'plain text' } }
        case 'image': {
            if (!block.url) return null
            if (isNotionHostedFile(block.url)) {
                /* Only reachable when the block this url came from is gone — otherwise the block is
                   kept and never rewritten. Said out loud rather than dropped in silence, since from
                   the page it looks like an image that went missing on save. */
                console.warn('[notion] image left out: Notion hosts it and its block is gone', block.url)
                return null
            }
            return {
                object: 'block',
                type: 'image',
                image: { type: 'external', external: { url: block.url }, caption: rich_text }
            }
        }
        default:
            return { object: 'block', type: block.type, [block.type]: { rich_text } }
    }
}

/** Notion's own file storage, whose urls are signed and time-limited. Recognised by host rather than
    by shape: the query string is the signature and changes on every read. */
function isNotionHostedFile(url: string): boolean {
    return /(^|\.)(amazonaws\.com|notion-static\.com)/.test(hostOf(url))
}

function hostOf(url: string): string {
    try {
        return new URL(url).host
    } catch {
        return ''
    }
}

/** What makes two urls the same picture. The path names the file; the query is a signature Notion
    re-issues every time the page is read, so an image loaded a minute ago and the same image now
    differ in the query and in nothing else. */
function imageKey(url: string): string {
    try {
        const parsed = new URL(url)
        return `${parsed.host}${parsed.pathname}`
    } catch {
        return url
    }
}

function imageUrl(block: NotionBlock): string | undefined {
    return block.image?.file?.url ?? block.image?.external?.url
}

/** Appends blocks, chunked at Notion's cap of 100 a call, optionally after an existing sibling.
    Returns the id of the last block it created, which is what lets a long body chain onto itself
    rather than every chunk landing at the end of the page. */
async function appendBlocks(
    blockId: string,
    children: Array<Record<string, unknown>>,
    after: string | null
): Promise<string | null> {
    let anchor = after

    for (let i = 0; i < children.length; i += 100) {
        const body: Record<string, unknown> = { children: children.slice(i, i + 100) }
        if (anchor) body.after = anchor

        const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children`, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify(body)
        })
        if (!res.ok) throw new Error(`Notion append blocks failed: ${res.status} ${await res.text()}`)

        const data = (await res.json()) as { results?: Array<{ id: string }> }
        const created = data.results ?? []
        if (created.length > 0) anchor = created[created.length - 1].id
    }

    return anchor === after ? null : anchor
}

/** Lays a markdown body down as blocks at the end of a page. */
async function setMarkdownBlocks(blockId: string, text: string): Promise<void> {
    const children = markdownToBlocks(text)
        .map(toNotionBlock)
        .filter((b): b is Record<string, unknown> => b !== null)

    await appendBlocks(blockId, children, null)
}

async function deleteBlock(blockId: string): Promise<void> {
    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, { method: 'DELETE', headers: headers() })
    if (!res.ok) throw new Error(`Notion block delete failed: ${res.status} ${await res.text()}`)
}

/** Replaces a page's body with `text`, keeping the images Notion is hosting.

    Those images cannot be rewritten — their urls are signed and expire — and Notion has no way to
    move a block, so they are the fixed points the rest of the page is rebuilt around. An image whose
    line is still in the markdown keeps its block untouched; one whose line has gone is deleted with
    everything else.

    The order of operations is what makes this work. Notion can insert after an existing block but
    never before one, so the new text goes in first, anchored to the old blocks that currently sit in
    front of each kept image, and the old blocks are deleted afterwards. Writing then deleting also
    means a failure halfway leaves the page holding both versions rather than neither.

    The one arrangement it cannot honour is text above an image that is already the first thing on
    the page: there is no block to insert after, so that text lands just below the image instead. */
async function rewritePageBody(pageId: string, text: string): Promise<void> {
    const existing = await fetchBlockChildren(pageId)
    /* An emptied page is emptied, not filled with the one blank paragraph a blank string parses to. */
    const parsed = text.trim() ? markdownToBlocks(text) : []

    const wanted = new Set(
        parsed.filter((b) => b.type === 'image' && b.url).map((b) => imageKey(b.url as string))
    )
    const keptByKey = new Map<string, NotionBlock>()
    for (const block of existing) {
        if (block.type !== 'image') continue
        const url = imageUrl(block)
        const key = url ? imageKey(url) : null
        /* First block wins if the same picture appears twice: the markdown names it once. */
        if (key && wanted.has(key) && !keptByKey.has(key)) keptByKey.set(key, block)
    }

    const keptIds = new Set(Array.from(keptByKey.values(), (b) => b.id))
    const predecessor = new Map<string, string | null>()
    let prev: string | null = null
    for (const block of existing) {
        if (keptIds.has(block.id)) predecessor.set(block.id, prev)
        prev = block.id
    }

    /* The markdown split at the kept images: each run of blocks goes after whatever currently sits
       in front of the image that follows it, and the last run goes at the end of the page. */
    const runs: Array<{ after: string | null; blocks: Array<Record<string, unknown>> }> = []
    let current: Array<Record<string, unknown>> = []

    for (const block of parsed) {
        const kept = block.type === 'image' && block.url ? keptByKey.get(imageKey(block.url)) : undefined
        if (kept) {
            runs.push({ after: predecessor.get(kept.id) ?? kept.id, blocks: current })
            current = []
            continue
        }

        const payload = toNotionBlock(block)
        if (payload) current.push(payload)
    }
    runs.push({ after: null, blocks: current })

    for (const run of runs) {
        if (run.blocks.length > 0) await appendBlocks(pageId, run.blocks, run.after)
    }

    /* Child pages are the page's own contents rather than its body — a folder's pages live this way
       — and the kept images have just been built around. Everything else was the old body. */
    for (const block of existing) {
        if (block.type === 'child_page' || keptIds.has(block.id)) continue
        await deleteBlock(block.id)
    }
}

/** Writes the project's instructions into its "Instructions" column.

    Chunked at 1900 characters the way the Chats table's text columns are: Notion caps one rich text
    object at 2000, and a column holds a list of them, so a long set of instructions goes in as
    several pieces and reads back as one string. */
export async function updateProjectInstructions(projectId: string, text: string): Promise<void> {
    await patchPage(projectId, { Instructions: { rich_text: toRichText(text) } }, 'instructions')
}

/** The chats and people a folder page records, read from the single `json` code block it keeps for
    them. A folder holding only pages never grows one, so a folder page with no code block is not an
    error — it simply has nothing filed that Notion could not hold itself. */
function parseFolderItems(blocks: NotionBlock[]): string[] {
    const codeBlock = blocks.find((b) => b.type === 'code')
    if (!codeBlock) return []

    try {
        const parsed = JSON.parse(plainText(codeBlock.code?.rich_text)) as { items?: unknown }
        return Array.isArray(parsed.items)
            ? parsed.items.filter((id): id is string => typeof id === 'string')
            : []
    } catch {
        /* Hand-edited into something unparseable: better an unfiled chat than a broken panel. */
        return []
    }
}

/** Reads one folder page: its title from the block that named it, its pages from the ones it links
    to, its chats and people from what is left over.

    A folder's links are sorted rather than listed: whichever of them name pages are the folder's
    pages, and the rest are its chats and people. Pages nested from before are read alongside them,
    so a folder that has not been touched since still holds what it held. */
async function fetchFolder(block: NotionBlock, pages: PageEntry[]): Promise<ContextFolder> {
    const children = await fetchBlockChildren(block.id)

    const recorded = parseFolderItems(children)
    const linked = linkedPageIds(children)

    return {
        id: block.id,
        name: folderName(block.child_page?.title ?? ''),
        pages: children
            .filter((b) => b.type === 'child_page')
            .map((b) => ({ id: b.id, title: b.child_page?.title ?? '' }))
            .concat(
                linked
                    .map((id) => pageById(pages, id))
                    .filter((page): page is PageEntry => page !== undefined)
                    .map((page) => ({ id: page.id, title: page.title }))
            ),
        /* Its own JSON block first, then whatever it links to that was not a page — a folder files a
           chat either way, and a page it links to is already among `pages` above. */
        items: recorded.concat(
            linked.filter(
                (id) => !pageById(pages, id) && !recorded.some((known) => sameNotionId(known, id))
            )
        )
    }
}

/** Which of a project's child pages are folders: the ones whose title carries the marker. Read
    straight off the block list, so telling them apart costs nothing.

    One request per folder, and only per folder — a project's context pages are never opened to find
    out what they are. Sequential rather than in parallel: Notion rate-limits at roughly three
    requests a second, the same reason `migrateChatProjectRefs` runs one at a time. */
async function fetchFolders(blocks: NotionBlock[], pages: PageEntry[]): Promise<ContextFolder[]> {
    const folders: ContextFolder[] = []

    for (const block of folderBlocks(blocks)) folders.push(await fetchFolder(block, pages))

    return folders
}

function folderBlocks(blocks: NotionBlock[]): NotionBlock[] {
    return blocks.filter((b) => b.type === 'child_page' && isFolderTitle(b.child_page?.title ?? ''))
}

/** Creates the folder's page under the project, titled with the marker that makes it one. The page
    is left empty: what goes in it is added later, as real child pages. */
export async function createContextFolder(projectId: string, name: string): Promise<string> {
    return createChildPage(projectId, folderTitle(name))
}

/** Archives the folder's page. Nothing filed in it is inside it any more — pages, chats and people
    alike are linked from it — so nothing goes to the trash with it. What the folder held simply
    stops being in the project, the same as unlinking each of them. A page nested from before the
    move to links is the exception: that one is still inside the folder page and goes with it,
    recoverable in the trash. */
export async function deleteContextFolder(folderId: string): Promise<void> {
    await archiveChatPage(folderId)
}

/** Writes the project's colour into its "Color" column. */
export async function updateProjectColor(projectId: string, color: string): Promise<void> {
    await patchPage(projectId, { Color: { rich_text: toRichText(color) } }, 'color')
}

/** Puts things in a project, or in one of its folders: one link block each, appended to the page.

    This is the whole of attaching now. A chat is not tagged on its own row and a person is not
    written into a JSON block — both are linked from the page they belong to, which is the same page
    a person opens in Notion to see what is in the project. Everything goes in one request, so
    picking six chats costs what picking one does. */
export async function linkContext(parentId: string, targetIds: string[]): Promise<void> {
    if (targetIds.length === 0) return

    const existing = linkedPageIds(await fetchBlockChildren(parentId))
    /* Linking something twice would draw it twice: the panel reads the page, and the page would say
       it is in there twice. */
    const fresh = targetIds.filter((id) => !existing.some((known) => sameNotionId(known, id)))
    if (fresh.length === 0) return

    await appendBlocks(
        parentId,
        fresh.map((id) => ({
            object: 'block',
            type: 'link_to_page',
            link_to_page: { type: 'page_id', page_id: id }
        })),
        null
    )
}

/** Takes something back out: deletes the link blocks naming it.

    A mention typed into a sentence in Notion is left alone. Removing one means rewriting the
    sentence around it, and a sentence is somebody's prose — so the app links, and what it linked is
    what it can unlink. Something added by "@" is removed the same way it was added. */
export async function unlinkContext(parentId: string, targetId: string): Promise<void> {
    const blocks = await fetchBlockChildren(parentId)

    for (const block of blocks) {
        if (block.type !== 'link_to_page') continue
        if (block.link_to_page?.page_id && sameNotionId(block.link_to_page.page_id, targetId)) {
            await deleteBlock(block.id)
        }
    }
}

/** Which projects each thing is in, worked out the only way membership can be read now: by looking
    in the projects.

    Nothing says what it belongs to any more — the projects do. Answering "which projects is this
    chat in?" therefore means reading every project, where before it was a column on the chat's own
    row. That is the price of one mechanism instead of three, and it is paid here, once, rather than
    by keeping a second copy of the answer on each thing and hoping the copies agree.

    Keyed by the linked page's id with its dashes stripped, and holding whatever was linked — a chat,
    a person, anything a project points at — so one walk answers for every kind of row that wants to
    show what it belongs to.

    One request per project and one per folder, sequential for the rate limit. The caller is expected
    to hold the result and refresh it when a project changes, not to ask per row.

    Chat row tags are still folded in, so a workspace that has not been migrated yet reads
    correctly. */
export async function fetchContextProjectMap(): Promise<Record<string, string[]>> {
    const [projects, chatLog] = await Promise.all([fetchProjects(), fetchChatLog()])
    const map: Record<string, string[]> = {}

    const add = (targetId: string, projectId: string): void => {
        const key = normalizeNotionId(targetId)
        const current = map[key] ?? (map[key] = [])
        if (!current.includes(projectId)) current.push(projectId)
    }

    for (const project of projects) {
        const blocks = await fetchBlockChildren(project.id)
        const linked = linkedPageIds(blocks)

        /* Something filed in a folder is in the project the folder belongs to, and its link lives on
           the folder's page. */
        for (const folder of folderBlocks(blocks)) {
            linked.push(...linkedPageIds(await fetchBlockChildren(folder.id)))
        }

        for (const id of linked) add(id, project.id)
        for (const chat of chatLog) {
            if (linksToProject(chat.projectRefs, project.id, project.title)) add(chat.id, project.id)
        }
    }

    return map
}

/** Moves every old membership record onto the page it describes, once.

    Three mechanisms became one: a chat tagged with a project's id on its own row, a person written
    into the project's CLAUDE.md, and a chat or person listed in a folder's JSON block all become a
    link block on the project or folder page. The old records are cleared as they are converted, so a
    second run over the same project finds nothing left to do and writes nothing.

    Ordering matters at every step: the link is written before the old record is cleared, so a
    failure halfway leaves the thing recorded twice — which reads as one membership — rather than in
    neither place. Sequential throughout, for Notion's rate limit.

    Returns what it converted, for the caller to log. */
export async function migrateProjectMembership(): Promise<{ chats: number; people: number; folders: number }> {
    const projects = await fetchProjects()
    const chatLog = await fetchChatLog()
    const counts = { chats: 0, people: 0, folders: 0 }

    for (const project of projects) {
        const blocks = await fetchBlockChildren(project.id)
        const alreadyLinked = linkedPageIds(blocks)
        const links: string[] = []

        /* Chats tagged with this project on their own row, by id or by the older title. */
        const tagged = chatLog.filter((c) => linksToProject(c.projectRefs, project.id, project.title))
        for (const chat of tagged) {
            if (!alreadyLinked.some((id) => sameNotionId(id, chat.id))) links.push(chat.id)
        }

        await linkContext(project.id, links)

        /* Cleared only now, with the links written: a tag dropped before its link exists is a
           membership lost. */
        for (const chat of tagged) {
            await detachChatFromProject(chat.id, project.id, project.title)
            counts.chats++
        }
        /* Each folder's JSON list becomes link blocks on the folder page, and the list goes. */
        for (const folder of folderBlocks(blocks)) {
            const children = await fetchBlockChildren(folder.id)
            const recorded = parseFolderItems(children)
            if (recorded.length === 0) continue

            const linkedHere = linkedPageIds(children)
            await linkContext(
                folder.id,
                recorded.filter((id) => !linkedHere.some((known) => sameNotionId(known, id)))
            )

            const codeBlock = children.find((b) => b.type === 'code')
            if (codeBlock) await deleteBlock(codeBlock.id)
            counts.folders++
        }
    }

    return counts
}

/** Rewrites a context page's own body with `text`, leaving its child pages and the images Notion is
    hosting for it untouched. */
export async function updateContextPageContent(pageId: string, text: string): Promise<void> {
    await rewritePageBody(pageId, text)
}

/** Creates a new page to hold one piece of context. It goes in the Pages table wherever it was made
    from, and `parentId` says what to link it from — the project, or one of its folder pages when the
    page is being made inside a folder. Passing the table itself makes a page that starts out in no
    project at all, which is the whole of creating a loose one. */
export async function createContextPage(parentId: string, title: string, text: string): Promise<string> {
    const id = await createPageRow(title || 'Untitled')
    if (text.trim()) await setMarkdownBlocks(id, text)
    if (!sameNotionId(parentId, PAGES_DATA_SOURCE_ID)) await linkContext(parentId, [id])
    return id
}

/** Adds the row itself. Its body is the empty page it starts as. */
async function createPageRow(title: string): Promise<string> {
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            parent: { type: 'data_source_id', data_source_id: PAGES_DATA_SOURCE_ID },
            properties: { Name: { title: [{ type: 'text', text: { content: title } }] } }
        })
    })

    if (!res.ok) throw new Error(`Notion page create failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { id: string }
    return data.id
}

/** Moves a context page from one place to another — between a project and one of its folders, or
    between two folders. The page itself does not move: it stays in the Pages table, and what changes is
    which page links to it.

    This used to be a copy and an archive, because a page was a child of the project and Notion
    cannot reparent one. Nothing is copied now, so the page keeps its id, its history, and the images
    Notion is hosting for it — all of which the copy left behind.

    The new link is written before the old one goes, so a failure in between leaves the page in both
    places rather than in neither. `linkContext` refuses a duplicate, so moving a page to where it
    already is does nothing. */
export async function moveContextPage(pageId: string, fromId: string, toId: string): Promise<string> {
    if (sameNotionId(fromId, toId)) return pageId

    await linkContext(toId, [pageId])
    await unlinkContext(fromId, pageId)
    return pageId
}

/** Creates a page that starts out in no project: it goes in the table and nothing links to it yet.
    Where pages live stays in here rather than travelling out to the renderer, which has no business
    knowing. */
export async function createPage(title: string, text: string): Promise<string> {
    return createContextPage(PAGES_DATA_SOURCE_ID, title, text)
}

/** Takes a page out of a project or a folder without touching the page: the link goes, the page
    stays in the table. This is what removing a page from a project means now — `deleteContextPage`
    is the one that archives it. */
export async function removeContextPage(parentId: string, pageId: string): Promise<void> {
    await unlinkContext(parentId, pageId)
}

/** Renames a folder, keeping the marker that makes it one. The name typed in the app is the title
    without it, so writing one back has to put it on again — a folder renamed to a plain title would
    stop being a folder. */
export async function renameContextFolder(folderId: string, name: string): Promise<void> {
    await updatePlainPageTitle(folderId, folderTitle(name))
}

/** Renames a context page. A page is a row, so its title is the "Name" column — kept separate from
    the others the way `renamePerson` is, so a caller reads as what it is doing rather than as what
    it borrows. */
export async function renameContextPage(pageId: string, title: string): Promise<void> {
    await updatePageTitle(pageId, title)
}

/** Deletes a context page outright by archiving it — it leaves Pages, and every project linking to
    it, and lands in Notion's trash, so a mis-click is still recoverable there. Taking a page out of
    one project without deleting it is `removeContextPage`. */
export async function deleteContextPage(pageId: string): Promise<void> {
    await archiveChatPage(pageId)
}

export async function fetchProjectDetail(pageId: string): Promise<ProjectDetail> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: headers() })
    if (!res.ok) throw new Error(`Notion page fetch failed: ${res.status} ${await res.text()}`)

    const page = (await res.json()) as { last_edited_time?: string; properties?: Record<string, unknown> }

    const blocks = await fetchBlockChildren(pageId)
    /* One request for every page in the workspace, rather than one per link: a link block names an
       id and no title, and the panel needs titles. */
    const pages = await fetchPages()
    /* Straight off the row's own columns. This is also called for a context page, which is not a
       row and has no such columns — it comes back with no colour and no instructions, which is what
       a page has. */
    const colorValue = scalarProperty(page as NotionPage, 'Color')
    const color = colorValue && HEX_COLOR.test(colorValue) ? colorValue : null
    const instructions = scalarProperty(page as NotionPage, 'Instructions') ?? ''
    const folders = await fetchFolders(blocks, pages)
    /* A folder page is a folder, not a piece of context: it shows up as its own kind of card and its
       pages are read from inside it, so it must not also appear in the list of context pages. */
    const contentBlocks = blocks.filter(
        (b) => !isInstructionsPage(b) && !isFolderTitle(b.child_page?.title ?? '')
    )
    const title = pageTitle(page.properties)

    /* What the project links to, its folders included — something filed in a folder is in the
       project, and the folder page is where its link lives. Read alongside the older records rather
       than instead of them: a chat tagged on its own row and a chat linked from here both belong to
       the project, so one can be migrated to the other without a flag day. */
    const linked = linkedPageIds(blocks).concat(folders.flatMap((f) => f.items))

    const chatLog = await fetchChatLog()
    const chats = chatLog
        .filter((c) => linksToProject(c.projectRefs, pageId, title) || linked.some((id) => sameNotionId(id, c.id)))
        .map((c) => ({ id: c.id, name: c.name, sessionId: c.sessionId, lastEdited: c.lastEdited }))

    /* Resolved against the People listing rather than fetched one page at a time — the ids are
       stored, the names are not, and a person deleted in Notion simply drops off the list. */
    const roster = linked.length > 0 ? await fetchPeople() : []
    const people = linked
        .map((id) => roster.find((person) => sameNotionId(person.id, id)))
        .filter((person): person is PersonEntry => person !== undefined)

    return {
        id: pageId,
        title,
        lastEdited: page.last_edited_time ?? null,
        instructions,
        color,
        blocks: toDetailBlocks(contentBlocks, pages),
        chats,
        people,
        folders
    }
}

/** Flattens a chat's session transcript to plain text, alternating "User:"/"Assistant:" lines.
    Injected context is dropped — a project quoting its own instructions back at itself is noise. */
function chatToText(sessionId: string): string {
    return readSessionTranscript(sessionId)
        .map((m) => ({
            role: m.role === 'user' ? 'User' : 'Assistant',
            text: m.parts
                .filter((p) => p.kind === 'text')
                .map((p) => p.text.trim())
                .join('\n')
                .trim()
        }))
        .filter((m) => m.text.length > 0)
        .map((m) => `${m.role}: ${m.text}`)
        .join('\n')
}

/** A stamp that changes whenever anything a project contributes to the system prompt changes.

    Notion's `last_edited_time` does not propagate upward — editing a child page leaves the parent's
    timestamp untouched — so the parent's own stamp is not enough on its own. Taking the maximum
    across the parent, every child page and every attached chat covers all three, and costs the
    three calls `fetchProjectDetail` already makes rather than the per-page content fetches that
    make `fetchProjectContext` expensive.

    An attached chat's transcript lives in the CLI's JSONL rather than in Notion, but it only ever
    grows when the app sends a message, and sending stamps the chat's row — so the row stands in for
    the transcript.

    `excludeSessionId` leaves one chat out, and must be the same one `fetchProjectContext` is told to
    skip: a stamp counting a chat the prompt does not contain would call the prompt stale on every
    message that chat sends. */
export async function fetchProjectVersion(projectId: string, excludeSessionId?: string): Promise<string> {
    const [page, blocks, chatLog] = await Promise.all([
        fetchPage(projectId),
        fetchBlockChildren(projectId),
        fetchChatLog()
    ])

    /* Only for the chats still tagged by title rather than by id — `linksToProject` matches those
       by name. */
    const title = pageTitle(page.properties)
    const linked = linkedPageIds(blocks)

    /* A page inside a folder is a grandchild of the project, so its stamp is not among the blocks
       above and editing it would otherwise leave the context looking fresh. Which blocks are folders
       is on the block list already, so this costs one call per folder and nothing else — context
       pages are still never fetched one at a time. */
    const folderStamps: Array<string | null> = []
    const folderLinks: string[] = []
    for (const block of folderBlocks(blocks)) {
        const children = await fetchBlockChildren(block.id)
        folderStamps.push(...children.map((b) => b.last_edited_time ?? null))
        folderLinks.push(...linkedPageIds(children))
    }

    /* A linked page is a row of its own, so its stamp is nowhere in the blocks above either — and
       unlike a nested page it is not even a grandchild of the project. The Pages listing carries
       every page's stamp, so covering them all costs the one request. */
    const pages = await fetchPages()
    const linkedPages = linked
        .concat(folderLinks)
        .map((id) => pageById(pages, id))
        .filter((page): page is PageEntry => page !== undefined)

    const stamps = [
        page.last_edited_time ?? null,
        ...blocks.filter((b) => b.type === 'child_page').map((b) => b.last_edited_time ?? null),
        ...folderStamps,
        ...linkedPages.map((page) => page.lastEdited),
        /* The excluded chat is excluded here too, or sending a message would restamp the project it
           belongs to, and the next send would rebuild a prompt that does not contain it anyway. */
        ...chatLog
            .filter((c) => linksToProject(c.projectRefs, projectId, title) || linked.some((id) => sameNotionId(id, c.id)))
            .filter((c) => !(excludeSessionId && c.sessionId === excludeSessionId))
            .map((c) => c.lastEdited)
    ].filter((t): t is string => Boolean(t))

    /* ISO-8601 UTC sorts correctly as a string, so no date parsing is needed. Empty for a project
       with nothing in it at all, which simply never looks stale. */
    return stamps.length === 0 ? '' : stamps.reduce((max, t) => (t > max ? t : max))
}

/** Concatenates a project's instructions, every context page's text, and every attached chat's transcript
    into one injectable block. Chats show up in the project's Context section same as pages (see
    ProjectDetailView's `contextItems`), so they belong here too — not just the child-page blocks.

    Folders survive the trip as labels rather than as nesting: every piece stays a top-level section,
    so the separator still cuts the injection one item to a block, and a filed item names its folder
    in its own heading. A contents list goes in ahead of them, so the grouping is legible as a whole
    before the pieces arrive one at a time. */
export async function fetchProjectContext(projectId: string, excludeSessionId?: string): Promise<string> {
    const detail = await fetchProjectDetail(projectId)
    /* The pages inside folders are pages of the project too, just held one level down in Notion.
       They are read the same way and labelled with their folder further below. */
    const contextPages = detail.blocks
        .filter((b) => b.type === 'child_page')
        .map((b) => ({ id: b.id, title: b.text }))
        .concat(detail.folders.flatMap((f) => f.pages))

    const folderOf = folderByItemId(detail.folders)

    const pageTexts = await Promise.all(
        contextPages.map(async (page) => {
            const children = await fetchBlockChildren(page.id)
            const text = children
                .map(toDetailBlock)
                .filter((b): b is ProjectDetailBlock => b !== null && b.type !== 'child_page' && b.type !== 'image' && b.text.trim().length > 0)
                .map((b) => b.text)
                .join('\n')
            return { id: page.id, title: page.title || 'Untitled', text }
        })
    )

    /* The chat this context is being assembled for is left out of it. Continuing a chat resumes its
       session, so the CLI already holds the conversation; injecting it as well would send every turn
       twice, and under a heading that calls the turn still being answered "already answered". */
    const chatTexts = detail.chats
        .filter((chat) => !(excludeSessionId && chat.sessionId === excludeSessionId))
        .map((chat) => ({
            id: chat.id,
            title: chat.name || 'Untitled',
            text: chat.sessionId ? chatToText(chat.sessionId) : ''
        }))

    /** `page "Notes"`, or `page "Notes" (in folder "Research")` for one that has been filed. */
    function describe(kind: string, title: string, id: string): string {
        const folder = folderOf.get(normalizeNotionId(id))
        return folder ? `${kind} "${title}" (in folder "${folder.name || 'Untitled'}")` : `${kind} "${title}"`
    }

    const parts: string[] = []
    if (detail.instructions.trim()) parts.push(`instructions:\n${detail.instructions.trim()}`)

    /* Only the folders that actually contribute: one holding nothing but empty pages produces no
       sections below, and announcing it would promise text that never arrives. */
    /* Normalised throughout: a folder names its members with the dashes stripped, and these ids come
       off blocks and rows with them in. */
    const carried = new Set(
        pageTexts
            .filter((p) => p.text.trim())
            .map((p) => normalizeNotionId(p.id))
            .concat(chatTexts.filter((c) => c.text.trim()).map((c) => normalizeNotionId(c.id)))
    )
    const nameOf = new Map<string, string>(
        pageTexts
            .map((p) => [normalizeNotionId(p.id), `page "${p.title}"`] as [string, string])
            .concat(
                chatTexts.map(
                    (c) => [normalizeNotionId(c.id), `past conversation "${c.title}"`] as [string, string]
                )
            )
    )
    const folderLines = detail.folders
        .map((folder) => ({
            name: folder.name || 'Untitled',
            members: folderMemberIds(folder)
                .filter((id) => carried.has(id))
                .map((id) => nameOf.get(id) ?? '')
        }))
        .filter((folder) => folder.members.length > 0)
        .map((folder) => `- "${folder.name}": ${folder.members.join(', ')}`)

    if (folderLines.length > 0) {
        parts.push(
            'folders: the user has grouped some of the context below. Items in the same folder ' +
                'belong together, and the folder name says what they have in common — read them as a ' +
                'set and take the name as part of what they mean. Anything not listed here is filed ' +
                `at the project's top level.\n${folderLines.join('\n')}`
        )
    }

    for (const p of pageTexts) {
        if (p.text.trim()) parts.push(`${describe('page', p.title, p.id)}:\n${p.text.trim()}`)
    }
    /* An attached chat is somebody's finished conversation, not a queue. Without saying so, its
       `User:` lines read as requests still waiting to be answered — the same way a bare list of
       questions once got answered instead of summarised when generating a chat title. */
    for (const c of chatTexts) {
        if (c.text.trim()) {
            parts.push(
                `${describe('past conversation', c.title, c.id)} — reference only, already answered, do not respond to it:\n${c.text.trim()}`
            )
        }
    }

    return parts.join(CONTEXT_SEPARATOR)
}

/** Rewrites the page's single code block with `text`, creating it if it doesn't exist yet. */
async function replaceCodeBlock(pageId: string, language: string, text: string): Promise<void> {
    const blocks = await fetchBlockChildren(pageId)
    const codeBlock = blocks.find((b) => b.type === 'code')
    const code = { language, rich_text: toRichText(text) }

    if (codeBlock) {
        const res = await fetch(`https://api.notion.com/v1/blocks/${codeBlock.id}`, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ code })
        })
        if (!res.ok) throw new Error(`Notion code block update failed: ${res.status} ${await res.text()}`)
        return
    }

    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ children: [{ object: 'block', type: 'code', code }] })
    })
    if (!res.ok) throw new Error(`Notion code block create failed: ${res.status} ${await res.text()}`)
}

/** Reads the Config page's JSON block.

    The whole configuration is one code block on that page, so this is a single request and adding a
    setting means adding a key rather than creating another sub-page. A page with no code block on it
    yet reads as empty config rather than being seeded — the block is written by hand, and inventing
    one behind the user's back would fight them for ownership of it. */
export async function fetchConfig(): Promise<AppConfig> {
    const blocks = await fetchBlockChildren(CONFIG_PAGE_ID)
    const codeBlock = blocks.find((b) => b.type === 'code')
    if (!codeBlock) return { ...EMPTY_CONFIG }

    const raw = plainText(codeBlock.code?.rich_text)
    try {
        return parseConfig(raw)
    } catch (error) {
        /* Named explicitly: a stray comma in Notion would otherwise surface as a chat that quietly
           stopped applying its system prompt. */
        throw new Error(`Config JSON on the Notion Config page is invalid: ${(error as Error).message}`)
    }
}

/** Rewrites that block wholesale. Callers pass the complete config, so a field they did not touch
    keeps whatever they read a moment ago rather than being dropped. */
export async function saveConfig(config: AppConfig): Promise<void> {
    await replaceCodeBlock(CONFIG_PAGE_ID, 'json', serializeConfig(config))
}

/* One row per skill in the Skills database. The name is the row's title, the mode is a column, and
   the body is the page itself — written as ordinary Notion blocks rather than as a string inside a
   JSON code block.

   The body was in that JSON until it had grown to eight thousand characters of headings, tables and
   fenced examples, all of it a single unreadable string with `
` in place of every line break. As
   the page's own content it is a document again: editable in Notion with Notion's editor, and
   diffable, foldable and searchable there like anything else. */

/** A skill's body: its page, read as markdown. Child pages are not part of it, the same rule a
    context page's body follows. */
function readSkillBody(blocks: NotionBlock[]): string {
    return blocksToMarkdown(
        blocks
            .map(toDetailBlock)
            .filter((b): b is ProjectDetailBlock => b !== null && b.type !== 'child_page')
    )
}

/** The mode column, falling back to one-shot for a row that has none — the safer default, since a
    persistent skill switched on by accident would attach itself to every turn of a chat with
    nothing to explain why. */
function readSkillMode(page: NotionPage): SkillData['mode'] {
    return scalarProperty(page, 'Mode') === 'persistent' ? 'persistent' : 'oneshot'
}

/** Every skill, bodies included.

    The bodies come along rather than being fetched on demand: a one-shot skill is invoked by typing
    its name and must be in the prompt the moment the message is sent, with no round trip to Notion
    in between. Skills are instructions, so they are small enough to hold. */
export async function fetchSkills(): Promise<Skill[]> {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${SKILLS_DATA_SOURCE_ID}/query`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({})
    })

    if (!res.ok) throw new Error(`Notion skills query failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { results: NotionPage[] }

    /* Names and modes arrive with the query; a body is a page and still costs a request each. */
    return Promise.all(
        data.results.map(async (page) => ({
            id: page.id,
            name: pageTitle(page.properties),
            mode: readSkillMode(page),
            body: readSkillBody(await fetchBlockChildren(page.id))
        }))
    )
}

/** One skill, read fresh.

    The list already carries bodies, but a skill open in the editor is re-read on selection so it
    shows what Notion holds now rather than what was loaded at startup — the same way a project
    fetches its detail when opened. */
export async function fetchSkill(pageId: string): Promise<Skill> {
    const [page, blocks] = await Promise.all([fetchPage(pageId), fetchBlockChildren(pageId)])

    return {
        id: pageId,
        name: pageTitle(page.properties),
        mode: readSkillMode(page as NotionPage),
        body: readSkillBody(blocks)
    }
}

/** Creates the row, with its mode set, so a new skill opens ready to edit. Its body is the empty
    page it starts as. */
export async function createSkill(name: string): Promise<string> {
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            parent: { type: 'data_source_id', data_source_id: SKILLS_DATA_SOURCE_ID },
            properties: {
                Name: { title: [{ type: 'text', text: { content: name } }] },
                Mode: { select: { name: EMPTY_SKILL_DATA.mode } }
            }
        })
    })

    if (!res.ok) throw new Error(`Notion skill create failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { id: string }
    return data.id
}

/** The mode goes to the column, the body to the page. Both are written even when only one changed:
    the editor saves the skill as a whole, the same way it always has. */
export async function saveSkill(pageId: string, skill: SkillData): Promise<void> {
    await patchPage(pageId, { Mode: { select: { name: skill.mode } } }, 'mode')
    await rewritePageBody(pageId, skill.body)
}

/** Renaming a skill is renaming its row — the title is the name, and what `/` matches. A row keeps
    its title in the column, so this is `updatePageTitle`, not the `title` property a plain page
    uses; patching the wrong key fails the whole request. */
export async function renameSkill(pageId: string, name: string): Promise<void> {
    await updatePageTitle(pageId, name)
}

export async function archiveSkill(pageId: string): Promise<void> {
    await archiveChatPage(pageId)
}

/* One row per person in the People database. The name is the row's title, the affiliation is a
   column, and whatever is known about them is the page itself.

   There is still nothing to configure — a person is the page and what it says — but a column is
   somewhere to put the one fact that is the same shape for everybody, where the page is for the
   part that never is. */

export interface PersonEntry {
    id: string
    name: string
    /** Where they are from — a company, a school, a team. Empty until somebody fills the column. */
    affiliation: string
}

export interface PersonDetail extends PersonEntry {
    blocks: ProjectDetailBlock[]
    lastEdited: string | null
}

/** The list for the sidebar: what the columns hold, so opening the section costs one request. The
    pages themselves are not opened — a person's page is read when that person is. */
export async function fetchPeople(): Promise<PersonEntry[]> {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${PEOPLE_DATA_SOURCE_ID}/query`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({})
    })

    if (!res.ok) throw new Error(`Notion people query failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { results: NotionPage[] }

    return data.results.map((page) => ({
        id: page.id,
        name: pageTitle(page.properties),
        affiliation: scalarProperty(page, 'Affiliation') ?? ''
    }))
}

/** One person's page, read fresh on selection the way a project's detail is. */
export async function fetchPerson(pageId: string): Promise<PersonDetail> {
    const [page, blocks] = await Promise.all([fetchPage(pageId), fetchBlockChildren(pageId)])

    return {
        id: pageId,
        name: pageTitle(page.properties),
        affiliation: scalarProperty(page as NotionPage, 'Affiliation') ?? '',
        lastEdited: page.last_edited_time ?? null,
        blocks: blocks.map(toDetailBlock).filter((b): b is ProjectDetailBlock => b !== null)
    }
}

export async function createPerson(name: string): Promise<string> {
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            parent: { type: 'data_source_id', data_source_id: PEOPLE_DATA_SOURCE_ID },
            properties: { Name: { title: [{ type: 'text', text: { content: name } }] } }
        })
    })

    if (!res.ok) throw new Error(`Notion person create failed: ${res.status} ${await res.text()}`)

    const data = (await res.json()) as { id: string }
    return data.id
}

/** Writes a person's affiliation into its column. */
export async function updatePersonAffiliation(pageId: string, affiliation: string): Promise<void> {
    await patchPage(pageId, { Affiliation: { rich_text: toRichText(affiliation) } }, 'affiliation')
}

/** Rewrites a person's page body, the same way a project's context page is written: the body is laid
    back down from the markdown, with child pages and Notion-hosted images left where they are.
    Anything richer than the markdown carries is flattened, which is why this only runs when the page
    has actually been edited here. */
export async function updatePersonContent(pageId: string, text: string): Promise<void> {
    await rewritePageBody(pageId, text)
}

/** Renaming a person is renaming their row, so the title goes in the "Name" column. */
export async function renamePerson(pageId: string, name: string): Promise<void> {
    await updatePageTitle(pageId, name)
}

export async function archivePerson(pageId: string): Promise<void> {
    await archiveChatPage(pageId)
}

/** Appends a single paragraph block holding `text` to the project page. */
export async function appendProjectNote(pageId: string, text: string): Promise<void> {
    if (!text.trim()) return

    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
            children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: toRichText(text) } }]
        })
    })

    if (!res.ok) throw new Error(`Notion project note append failed: ${res.status} ${await res.text()}`)
}
