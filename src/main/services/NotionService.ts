import 'dotenv/config'
import { readSessionTranscript } from './SessionTranscript'
import { CONTEXT_SEPARATOR } from '../../shared/injection'
import { EMPTY_CONFIG, parseConfig, serializeConfig, type AppConfig } from '../../shared/config'
import { markdownToBlocks, type MarkdownBlock } from '../../shared/markdown'
import { EMPTY_SKILL_DATA, parseSkillData, serializeSkillData, type Skill, type SkillData } from '../../shared/skills'
import { isNotionId, normalizeNotionId, sameNotionId } from '../../shared/notionId'

const NOTION_VERSION = '2025-09-03'
const CHAT_LOG_DATA_SOURCE_ID = 'efe919c7-c9c1-404e-ac41-2b5210790815'
const PROJECTS_PAGE_ID = '31bb837d9c3180ab9ed4fd1eb7e752a9'
const CONFIG_PAGE_ID = '3c6b837d9c31801a9e5df548713eca5e'
const SKILLS_PAGE_ID = '3cbb837d9c318021bf05fedebf3005e1'
const PEOPLE_PAGE_ID = '3cbb837d9c318032af5fffeb1d48a507'

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

/** Reads a property that may be stored as either a select or a text field, so the Chat Log's
    columns work however they were set up in Notion. */
function scalarProperty(page: NotionPage, name: string): string | null {
    const prop = page.properties[name] as
        | { select?: { name: string } | null; rich_text?: NotionRichText[]; title?: NotionRichText[] }
        | undefined
    const value = prop?.select?.name ?? plainText(prop?.rich_text ?? prop?.title)
    return value?.trim() ? value.trim() : null
}

/** Notion rejects a value shaped for the wrong property type, so the payload is built from the
    data source's own schema rather than assumed. Fetched once and cached. */
let propertyTypes: Record<string, string> | null = null

async function fetchPropertyTypes(): Promise<Record<string, string>> {
    if (propertyTypes) return propertyTypes

    const res = await fetch(`https://api.notion.com/v1/data_sources/${CHAT_LOG_DATA_SOURCE_ID}`, {
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
    const res = await fetch(`https://api.notion.com/v1/data_sources/${CHAT_LOG_DATA_SOURCE_ID}/query`, {
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
    image?: { type: 'file' | 'external'; file?: { url: string }; external?: { url: string } }
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

/** Replaces the Chat Log's "Project" multi-select with one option per project page id.

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

/** Converts every chat row still tagged with a project title over to that project's id, so nothing
    is left depending on the title fallback — a row that has been migrated survives a rename in
    Notion, one that has not does not.

    Called with the project list rather than reading it, because the renderer already holds one and
    building it costs a request per project. Rows are written only when something actually changes,
    so this settles into a pair of reads and can run at every start. A title matching no known
    project is left as it is: an archived project or a typo is not this function's to throw away.

    Sequential on purpose. Notion rate-limits at roughly three requests a second, and one in-flight
    request at a time stays under that without any retry machinery. Returns the number of rows it
    rewrote. */
export async function migrateChatProjectRefs(
    projects: Array<{ id: string; title: string }>
): Promise<number> {
    const idByTitle = new Map(projects.map((p) => [p.title, p.id]))
    const log = await fetchChatLog()
    let migrated = 0

    for (const chat of log) {
        const replaced = chat.projectRefs.map((ref) => (isNotionId(ref) ? ref : (idByTitle.get(ref) ?? ref)))
        /* A row holding both the id and the old title of one project collapses to a single tag. */
        const next = Array.from(
            new Map(replaced.map((ref) => [isNotionId(ref) ? normalizeNotionId(ref) : ref, ref])).values()
        )

        const unchanged =
            next.length === chat.projectRefs.length && next.every((ref, i) => ref === chat.projectRefs[i])
        if (unchanged) continue

        await setChatProjects(chat.id, next)
        migrated++
    }

    return migrated
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
            parent: { type: 'data_source_id', data_source_id: CHAT_LOG_DATA_SOURCE_ID },
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

/** Archives (soft-deletes) the Chat Log page — Notion's DELETE for a page. */
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
    preview: string
    color: string | null
}

/** First non-empty paragraph among a page's top-level blocks — used as the card preview. */
function firstPreview(blocks: NotionBlock[]): string {
    for (const block of blocks) {
        const text = plainText(block.paragraph?.rich_text)
        if (text) return text
    }
    return ''
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

async function fetchPageLastEdited(pageId: string): Promise<string | null> {
    return (await fetchPage(pageId)).last_edited_time ?? null
}

/** Every child page under the Projects page — one card per sub-page. */
export async function fetchProjects(): Promise<ProjectEntry[]> {
    const blocks = await fetchBlockChildren(PROJECTS_PAGE_ID)
    const childPages = blocks.filter((b) => b.type === 'child_page')

    return Promise.all(
        childPages.map(async (block) => {
            const [lastEdited, children] = await Promise.all([
                fetchPageLastEdited(block.id),
                fetchBlockChildren(block.id)
            ])
            return {
                id: block.id,
                title: block.child_page?.title ?? '',
                lastEdited,
                preview: firstPreview(children),
                color: (await fetchClaudeMd(children)).color
            }
        })
    )
}

export async function createProjectPage(title: string): Promise<string> {
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            parent: { type: 'page_id', page_id: PROJECTS_PAGE_ID },
            properties: { title: { title: [{ type: 'text', text: { content: title } }] } }
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

export async function updateProjectTitle(pageId: string, title: string): Promise<void> {
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
            return {
                id: block.id,
                type: 'image',
                text: '',
                url: block.image?.file?.url ?? block.image?.external?.url
            }
        default:
            return { id: block.id, type: 'paragraph', text: plainText(block.paragraph?.rich_text) }
    }
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
    /** People attached to this project, resolved from the ids in its CLAUDE.md block. */
    people: PersonEntry[]
}

function isInstructionsPage(block: NotionBlock): boolean {
    return block.type === 'child_page' && block.child_page?.title?.trim().toLowerCase() === 'claude.md'
}

interface ClaudeMdData {
    instructions: string
    color: string | null
    /** Page ids of the people attached to this project. Held here rather than on the person's page:
        a person is a plain child page with no properties to hang a back-reference from, and the
        attachment belongs to the project anyway. */
    people: string[]
}

const EMPTY_CLAUDE_MD: ClaudeMdData = { instructions: '', color: null, people: [] }

/** The "CLAUDE.md" page's body: a single `json` code block, falling back to its raw text if it isn't parseable JSON. */
async function readClaudeMdText(pageId: string): Promise<string> {
    const children = await fetchBlockChildren(pageId)
    const codeBlock = children.find((b) => b.type === 'code')
    if (codeBlock) return plainText(codeBlock.code?.rich_text)

    return children
        .map((b) => toDetailBlock(b))
        .filter((b): b is ProjectDetailBlock => b !== null && b.text.trim().length > 0)
        .map((b) => b.text)
        .join('\n')
}

function parseClaudeMd(text: string): ClaudeMdData {
    try {
        const parsed = JSON.parse(text) as { instructions?: unknown; color?: unknown; people?: unknown }
        const instructions = typeof parsed.instructions === 'string' ? parsed.instructions : ''
        const color = typeof parsed.color === 'string' && HEX_COLOR.test(parsed.color) ? parsed.color : null
        const people = Array.isArray(parsed.people)
            ? parsed.people.filter((id): id is string => typeof id === 'string')
            : []
        return { instructions, color, people }
    } catch {
        /* Written before the block was JSON: the whole body was the instructions. */
        return { instructions: text, color: null, people: [] }
    }
}

/** Instructions and color come only from a dedicated "CLAUDE.md" child page — no such page means neither. */
async function fetchClaudeMd(blocks: NotionBlock[]): Promise<ClaudeMdData> {
    const page = blocks.find(isInstructionsPage)
    if (!page) return EMPTY_CLAUDE_MD

    return parseClaudeMd(await readClaudeMdText(page.id))
}

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
    `blocksToMarkdown`, which is what keeps the round trip honest. */
function toNotionBlock(block: MarkdownBlock): Record<string, unknown> {
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
        default:
            return { object: 'block', type: block.type, [block.type]: { rich_text } }
    }
}

/** Lays a markdown body down as blocks. Notion caps a single append at 100 children. */
async function setMarkdownBlocks(blockId: string, text: string): Promise<void> {
    const children = markdownToBlocks(text).map(toNotionBlock)

    for (let i = 0; i < children.length; i += 100) {
        const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children`, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ children: children.slice(i, i + 100) })
        })
        if (!res.ok) throw new Error(`Notion append blocks failed: ${res.status} ${await res.text()}`)
    }
}

/** Finds the project's "CLAUDE.md" child page, creating it if it doesn't exist yet, alongside its current parsed data. */
async function getOrCreateClaudeMd(projectId: string): Promise<{ id: string; current: ClaudeMdData }> {
    const blocks = await fetchBlockChildren(projectId)
    const existing = blocks.find(isInstructionsPage)
    if (existing) return { id: existing.id, current: parseClaudeMd(await readClaudeMdText(existing.id)) }

    const id = await createChildPage(projectId, 'CLAUDE.md')
    return { id, current: EMPTY_CLAUDE_MD }
}

/** Rewrites the dedicated "CLAUDE.md" child page's JSON body with `text` as the instructions, preserving its color. */
export async function updateProjectInstructions(projectId: string, text: string): Promise<void> {
    const { id, current } = await getOrCreateClaudeMd(projectId)
    await replaceCodeBlock(id, 'json', JSON.stringify({ ...current, instructions: text }, null, 2))
}

/** Replaces the project's attached people. Callers pass the whole list, so attaching and detaching
    are the same write. */
export async function updateProjectPeople(projectId: string, personIds: string[]): Promise<void> {
    const { id, current } = await getOrCreateClaudeMd(projectId)
    await replaceCodeBlock(id, 'json', JSON.stringify({ ...current, people: personIds }, null, 2))
}

/** Rewrites the dedicated "CLAUDE.md" child page's JSON body with `color`, preserving its instructions. */
export async function updateProjectColor(projectId: string, color: string): Promise<void> {
    const { id, current } = await getOrCreateClaudeMd(projectId)
    await replaceCodeBlock(id, 'json', JSON.stringify({ ...current, color }, null, 2))
}

/** Adds a project to a chat's row, leaving whatever else it was already filed under. Mirrors
    `detachChatFromProject`: the current tags are read back from Notion rather than taken from the
    caller, so a chat tagged from somewhere else keeps those tags. */
export async function attachChatToProject(
    chatPageId: string,
    projectId: string,
    projectTitle: string
): Promise<void> {
    const page = await fetchPage(chatPageId)
    const current = projectRefs(page.properties ?? {})
    if (linksToProject(current, projectId, projectTitle)) return

    await setChatProjects(chatPageId, current.concat(projectId))
}

async function clearNonChildPageBlocks(blockId: string): Promise<void> {
    const children = await fetchBlockChildren(blockId)
    await Promise.all(
        children
            .filter((b) => b.type !== 'child_page')
            .map(async (b) => {
                const res = await fetch(`https://api.notion.com/v1/blocks/${b.id}`, { method: 'DELETE', headers: headers() })
                if (!res.ok) throw new Error(`Notion block delete failed: ${res.status} ${await res.text()}`)
            })
    )
}

/** Rewrites a context page's own text content with `text`, leaving any of its child pages untouched. */
export async function updateContextPageContent(pageId: string, text: string): Promise<void> {
    await clearNonChildPageBlocks(pageId)
    if (text.trim()) await setMarkdownBlocks(pageId, text)
}

/** Creates a new child page under the project to hold one piece of context. */
export async function createContextPage(projectId: string, title: string, text: string): Promise<string> {
    const id = await createChildPage(projectId, title || 'Untitled')
    if (text.trim()) await setMarkdownBlocks(id, text)
    return id
}

/** Removes a context page from the project by archiving it — it leaves the project and lands in
    Notion's trash, so a mis-click is still recoverable there. */
export async function deleteContextPage(pageId: string): Promise<void> {
    await archiveChatPage(pageId)
}

export async function fetchProjectDetail(pageId: string): Promise<ProjectDetail> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: headers() })
    if (!res.ok) throw new Error(`Notion page fetch failed: ${res.status} ${await res.text()}`)

    const page = (await res.json()) as { last_edited_time?: string; properties?: Record<string, unknown> }
    const titleProp = page.properties?.title as { title?: NotionRichText[] } | undefined

    const blocks = await fetchBlockChildren(pageId)
    const { instructions, color, people: personIds } = await fetchClaudeMd(blocks)
    const contentBlocks = blocks.filter((b) => !isInstructionsPage(b))
    const title = plainText(titleProp?.title)

    const chatLog = await fetchChatLog()
    const chats = chatLog
        .filter((c) => linksToProject(c.projectRefs, pageId, title))
        .map((c) => ({ id: c.id, name: c.name, sessionId: c.sessionId, lastEdited: c.lastEdited }))

    /* Resolved against the People listing rather than fetched one page at a time — the ids are
       stored, the names are not, and a person deleted in Notion simply drops off the list. */
    const roster = personIds.length > 0 ? await fetchPeople() : []
    const people = personIds
        .map((id) => roster.find((person) => person.id === id))
        .filter((person): person is PersonEntry => person !== undefined)

    return {
        id: pageId,
        title,
        lastEdited: page.last_edited_time ?? null,
        instructions,
        color,
        blocks: contentBlocks.map(toDetailBlock).filter((b): b is ProjectDetailBlock => b !== null),
        chats,
        people
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
    the transcript. */
export async function fetchProjectVersion(projectId: string): Promise<string> {
    const [page, blocks, chatLog] = await Promise.all([
        fetchPage(projectId),
        fetchBlockChildren(projectId),
        fetchChatLog()
    ])

    /* Only for the chats still tagged by title rather than by id — `linksToProject` matches those
       by name. */
    const title = plainText((page.properties?.title as { title?: NotionRichText[] } | undefined)?.title)

    const stamps = [
        page.last_edited_time ?? null,
        ...blocks.filter((b) => b.type === 'child_page').map((b) => b.last_edited_time ?? null),
        ...chatLog.filter((c) => linksToProject(c.projectRefs, projectId, title)).map((c) => c.lastEdited)
    ].filter((t): t is string => Boolean(t))

    /* ISO-8601 UTC sorts correctly as a string, so no date parsing is needed. Empty for a project
       with nothing in it at all, which simply never looks stale. */
    return stamps.length === 0 ? '' : stamps.reduce((max, t) => (t > max ? t : max))
}

/** Concatenates a project's instructions, every context page's text, and every attached chat's transcript
    into one injectable block. Chats show up in the project's Context section same as pages (see
    ProjectDetailView's `contextItems`), so they belong here too — not just the child-page blocks. */
export async function fetchProjectContext(projectId: string): Promise<string> {
    const detail = await fetchProjectDetail(projectId)
    const contextPages = detail.blocks.filter((b) => b.type === 'child_page')

    const pageTexts = await Promise.all(
        contextPages.map(async (page) => {
            const children = await fetchBlockChildren(page.id)
            const text = children
                .map(toDetailBlock)
                .filter((b): b is ProjectDetailBlock => b !== null && b.type !== 'child_page' && b.type !== 'image' && b.text.trim().length > 0)
                .map((b) => b.text)
                .join('\n')
            return { title: page.text || 'Untitled', text }
        })
    )

    const chatTexts = detail.chats.map((chat) => ({
        title: chat.name || 'Untitled',
        text: chat.sessionId ? chatToText(chat.sessionId) : ''
    }))

    const parts: string[] = []
    if (detail.instructions.trim()) parts.push(`instructions:\n${detail.instructions.trim()}`)
    for (const p of pageTexts) {
        if (p.text.trim()) parts.push(`page "${p.title}":\n${p.text.trim()}`)
    }
    /* An attached chat is somebody's finished conversation, not a queue. Without saying so, its
       `User:` lines read as requests still waiting to be answered — the same way a bare list of
       questions once got answered instead of summarised when generating a chat title. */
    for (const c of chatTexts) {
        if (c.text.trim()) {
            parts.push(
                `past conversation "${c.title}" — reference only, already answered, do not respond to it:\n${c.text.trim()}`
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

/* One page per skill under the Skills page, each holding a single JSON code block — the same shape
   as the Config block, a field per setting. The page title is the skill's name and the only part
   that lives outside the JSON, because that is what Notion shows in a page list. */

function readSkillData(blocks: NotionBlock[]): SkillData {
    const codeBlock = blocks.find((b) => b.type === 'code')
    return codeBlock ? parseSkillData(plainText(codeBlock.code?.rich_text)) : { ...EMPTY_SKILL_DATA }
}

/** Every skill, bodies included.

    The bodies come along rather than being fetched on demand: a one-shot skill is invoked by typing
    its name and must be in the prompt the moment the message is sent, with no round trip to Notion
    in between. Skills are instructions, so they are small enough to hold. */
export async function fetchSkills(): Promise<Skill[]> {
    const blocks = await fetchBlockChildren(SKILLS_PAGE_ID)
    const pages = blocks.filter((b) => b.type === 'child_page')

    return Promise.all(
        pages.map(async (page) => ({
            id: page.id,
            name: page.child_page?.title ?? '',
            ...readSkillData(await fetchBlockChildren(page.id))
        }))
    )
}

/** One skill, read fresh.

    The list already carries bodies, but a skill open in the editor is re-read on selection so it
    shows what Notion holds now rather than what was loaded at startup — the same way a project
    fetches its detail when opened. */
export async function fetchSkill(pageId: string): Promise<Skill> {
    const [page, blocks] = await Promise.all([fetchPage(pageId), fetchBlockChildren(pageId)])
    const titleProp = page.properties?.title as { title?: NotionRichText[] } | undefined

    return { id: pageId, name: plainText(titleProp?.title), ...readSkillData(blocks) }
}

/** Creates the page and its block, so a new skill opens ready to edit rather than empty. */
export async function createSkill(name: string): Promise<string> {
    const pageId = await createChildPage(SKILLS_PAGE_ID, name)
    await saveSkill(pageId, { ...EMPTY_SKILL_DATA })
    return pageId
}

export async function saveSkill(pageId: string, skill: SkillData): Promise<void> {
    await replaceCodeBlock(pageId, 'json', serializeSkillData(skill))
}

/** Renaming a skill is renaming its page — the title is the name, and what `/` matches.

    Not `updatePageTitle`: that one writes the `Name` property, which is what the chat database's
    rows call their title. A child page under a page has no such property; its title is the one
    called `title`, and patching the wrong key fails the whole request. */
export async function renameSkill(pageId: string, name: string): Promise<void> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
            properties: { title: { title: [{ type: 'text', text: { content: name } }] } }
        })
    })

    if (!res.ok) throw new Error(`Notion skill rename failed: ${res.status} ${await res.text()}`)
}

export async function archiveSkill(pageId: string): Promise<void> {
    await archiveChatPage(pageId)
}

/* One page per person under the People page. Unlike a project there is nothing to configure — a
   person is the Notion page and nothing else, so the app only lists them and shows what the page
   says. Editing happens in Notion. */

export interface PersonEntry {
    id: string
    name: string
}

export interface PersonDetail extends PersonEntry {
    blocks: ProjectDetailBlock[]
    lastEdited: string | null
}

/** The list for the sidebar: names only, so opening the section costs one request. */
export async function fetchPeople(): Promise<PersonEntry[]> {
    const blocks = await fetchBlockChildren(PEOPLE_PAGE_ID)

    return blocks
        .filter((b) => b.type === 'child_page')
        .map((b) => ({ id: b.id, name: b.child_page?.title ?? '' }))
}

/** One person's page, read fresh on selection the way a project's detail is. */
export async function fetchPerson(pageId: string): Promise<PersonDetail> {
    const [page, blocks] = await Promise.all([fetchPage(pageId), fetchBlockChildren(pageId)])
    const titleProp = page.properties?.title as { title?: NotionRichText[] } | undefined

    return {
        id: pageId,
        name: plainText(titleProp?.title),
        lastEdited: page.last_edited_time ?? null,
        blocks: blocks.map(toDetailBlock).filter((b): b is ProjectDetailBlock => b !== null)
    }
}

export async function createPerson(name: string): Promise<string> {
    return createChildPage(PEOPLE_PAGE_ID, name)
}

/** Rewrites a person's page body, the same way a project's context page is written: the existing
    blocks are cleared and the text laid back down as paragraphs. Anything richer than a paragraph
    is flattened, which is why this only runs when the page has actually been edited here. */
export async function updatePersonContent(pageId: string, text: string): Promise<void> {
    await clearNonChildPageBlocks(pageId)
    if (text.trim()) await setMarkdownBlocks(pageId, text)
}

export async function renamePerson(pageId: string, name: string): Promise<void> {
    await renameSkill(pageId, name)
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
