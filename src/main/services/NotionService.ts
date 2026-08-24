import 'dotenv/config'

const NOTION_VERSION = '2025-09-03'
const CHAT_LOG_DATA_SOURCE_ID = 'efe919c7-c9c1-404e-ac41-2b5210790815'
const PROJECTS_PAGE_ID = '31bb837d9c3180ab9ed4fd1eb7e752a9'
const CONFIG_PAGE_ID = '3c6b837d9c31801a9e5df548713eca5e'

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
}

interface NotionPage {
    id: string
    properties: Record<string, unknown>
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
            lastActive: lastActiveProp?.date?.start ?? null
        }
    })
}

export interface ChatToolCall {
    name: string
    query: string
}

/** Stored shape — role is positional: messages alternate, starting with the user. */
export interface ChatMessage {
    content: string
    tools: ChatToolCall[]
    /** Titles of the projects injected into this message. */
    projects: string[]
}

export type ChatTranscriptMessage = ChatMessage & { role: 'user' | 'assistant' }

function roleAt(index: number): 'user' | 'assistant' {
    return index % 2 === 0 ? 'user' : 'assistant'
}

/** Page body contract: a single `json` code block holding this object. */
interface ChatTranscriptDocument {
    messages: ChatMessage[]
}

interface NotionBlock {
    id: string
    type: string
    heading_1?: { rich_text: NotionRichText[] }
    heading_2?: { rich_text: NotionRichText[] }
    heading_3?: { rich_text: NotionRichText[] }
    paragraph?: { rich_text: NotionRichText[] }
    bulleted_list_item?: { rich_text: NotionRichText[] }
    numbered_list_item?: { rich_text: NotionRichText[] }
    to_do?: { rich_text: NotionRichText[]; checked?: boolean }
    quote?: { rich_text: NotionRichText[] }
    code?: { rich_text: NotionRichText[] }
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

function codeBlockBody(messages: ChatMessage[]): Record<string, unknown> {
    const document: ChatTranscriptDocument = {
        messages: messages.map((m) => ({ content: m.content, tools: m.tools, projects: m.projects }))
    }
    return {
        object: 'block',
        type: 'code',
        code: { language: 'json', rich_text: toRichText(JSON.stringify(document, null, 2)) }
    }
}

/** Rewrites the transcript code block with the existing messages plus the new ones. */
export async function appendMessages(pageId: string, messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return

    const blocks = await fetchBlockChildren(pageId)
    const existing = parseTranscriptBlocks(blocks)
    const body = codeBlockBody(existing.concat(messages))

    const codeBlock = blocks.find((b) => b.type === 'code')
    if (codeBlock) {
        const res = await fetch(`https://api.notion.com/v1/blocks/${codeBlock.id}`, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ code: body.code })
        })
        if (!res.ok) throw new Error(`Notion transcript update failed: ${res.status} ${await res.text()}`)
        return
    }

    const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ children: [body] })
    })
    if (!res.ok) throw new Error(`Notion append blocks failed: ${res.status} ${await res.text()}`)
}

/** Sets the Chat Log's "Project" select property — the option name must match an existing project title. */
export async function setChatProject(pageId: string, projectTitle: string): Promise<void> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({
            properties: { Project: { select: { name: projectTitle } } }
        })
    })

    if (!res.ok) throw new Error(`Notion chat project update failed: ${res.status} ${await res.text()}`)
}

export async function createChatPage(name: string): Promise<string> {
    const res = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
            parent: { type: 'data_source_id', data_source_id: CHAT_LOG_DATA_SOURCE_ID },
            properties: {
                Name: { title: [{ type: 'text', text: { content: name } }] },
                'Last active': { date: { start: new Date().toISOString() } }
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

function normalizeMessage(raw: unknown): ChatMessage | null {
    if (typeof raw !== 'object' || raw === null) return null
    const m = raw as Record<string, unknown>
    const tools = Array.isArray(m.tools)
        ? m.tools
              .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
              .map((t) => ({ name: String(t.name ?? 'tool'), query: String(t.query ?? '') }))
        : []

    const projects = Array.isArray(m.projects) ? m.projects.filter((p): p is string => typeof p === 'string') : []

    return { content: String(m.content ?? ''), tools, projects }
}

/**
 * Legacy body: a sequence of Heading-3 blocks each followed by the message's
 * text blocks, broken by "## Run N" headings and dividers. Speakers alternate
 * starting with the user, so the heading label itself is ignored.
 */
function parseLegacyBlocks(blocks: NotionBlock[]): ChatMessage[] {
    const messages: ChatMessage[] = []
    let current: ChatMessage | null = null

    for (const block of blocks) {
        if (block.type === 'heading_3') {
            if (current) messages.push(current)
            current = { content: '', tools: [], projects: [] }
            continue
        }

        if (block.type === 'heading_2' || block.type === 'divider' || block.type === 'quote') {
            if (current) messages.push(current)
            current = null
            continue
        }

        if (!current) continue

        const text = block.type === 'code' ? plainText(block.code?.rich_text) : plainText(block.paragraph?.rich_text)
        if (text) current.content = current.content ? `${current.content}\n${text}` : text
    }

    if (current) messages.push(current)

    return messages
}

/** Reads the `json` transcript code block, falling back to the legacy heading layout. */
function parseTranscriptBlocks(blocks: NotionBlock[]): ChatMessage[] {
    const codeBlock = blocks.find((b) => b.type === 'code')

    if (codeBlock) {
        try {
            const parsed = JSON.parse(plainText(codeBlock.code?.rich_text)) as ChatTranscriptDocument
            if (Array.isArray(parsed?.messages)) {
                return parsed.messages.map(normalizeMessage).filter((m): m is ChatMessage => m !== null)
            }
        } catch {
            // Not the transcript block — fall through to the legacy layout.
        }
    }

    return parseLegacyBlocks(blocks)
}

/** Roles are positional: messages alternate, starting with the user. */
export async function fetchChatTranscript(pageId: string): Promise<ChatTranscriptMessage[]> {
    const messages = parseTranscriptBlocks(await fetchBlockChildren(pageId))
    return messages.map((m, i) => ({ ...m, role: roleAt(i) }))
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

async function fetchPageLastEdited(pageId: string): Promise<string | null> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: headers() })
    if (!res.ok) throw new Error(`Notion page fetch failed: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { last_edited_time?: string }
    return data.last_edited_time ?? null
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

export interface ProjectDetail {
    id: string
    title: string
    lastEdited: string | null
    instructions: string
    color: string | null
    blocks: ProjectDetailBlock[]
}

function isInstructionsPage(block: NotionBlock): boolean {
    return block.type === 'child_page' && block.child_page?.title?.trim().toLowerCase() === 'claude.md'
}

interface ClaudeMdData {
    instructions: string
    color: string | null
}

const EMPTY_CLAUDE_MD: ClaudeMdData = { instructions: '', color: null }

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
        const parsed = JSON.parse(text) as { instructions?: unknown; color?: unknown }
        const instructions = typeof parsed.instructions === 'string' ? parsed.instructions : ''
        const color = typeof parsed.color === 'string' && HEX_COLOR.test(parsed.color) ? parsed.color : null
        return { instructions, color }
    } catch {
        return { instructions: text, color: null }
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

async function setParagraphs(blockId: string, text: string): Promise<void> {
    const children = text
        .split('\n')
        .map((line) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: toRichText(line) } }))

    for (let i = 0; i < children.length; i += 100) {
        const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children`, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ children: children.slice(i, i + 100) })
        })
        if (!res.ok) throw new Error(`Notion append paragraphs failed: ${res.status} ${await res.text()}`)
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
    const data: ClaudeMdData = { instructions: text, color: current.color }
    await replaceCodeBlock(id, 'json', JSON.stringify(data, null, 2))
}

/** Rewrites the dedicated "CLAUDE.md" child page's JSON body with `color`, preserving its instructions. */
export async function updateProjectColor(projectId: string, color: string): Promise<void> {
    const { id, current } = await getOrCreateClaudeMd(projectId)
    const data: ClaudeMdData = { instructions: current.instructions, color }
    await replaceCodeBlock(id, 'json', JSON.stringify(data, null, 2))
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
    if (text.trim()) await setParagraphs(pageId, text)
}

/** Creates a new child page under the project to hold one piece of context. */
export async function createContextPage(projectId: string, title: string, text: string): Promise<string> {
    const id = await createChildPage(projectId, title || 'Untitled')
    if (text.trim()) await setParagraphs(id, text)
    return id
}

export async function fetchProjectDetail(pageId: string): Promise<ProjectDetail> {
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: headers() })
    if (!res.ok) throw new Error(`Notion page fetch failed: ${res.status} ${await res.text()}`)

    const page = (await res.json()) as { last_edited_time?: string; properties?: Record<string, unknown> }
    const titleProp = page.properties?.title as { title?: NotionRichText[] } | undefined

    const blocks = await fetchBlockChildren(pageId)
    const { instructions, color } = await fetchClaudeMd(blocks)
    const contentBlocks = blocks.filter((b) => !isInstructionsPage(b))

    return {
        id: pageId,
        title: plainText(titleProp?.title),
        lastEdited: page.last_edited_time ?? null,
        instructions,
        color,
        blocks: contentBlocks.map(toDetailBlock).filter((b): b is ProjectDetailBlock => b !== null)
    }
}

/** Concatenates a project's instructions and every context page's text into one injectable block. */
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

    const parts: string[] = []
    if (detail.instructions.trim()) parts.push(`guidelines:\n${detail.instructions.trim()}`)
    for (const p of pageTexts) {
        if (p.text.trim()) parts.push(`title: ${p.title}\ncontent: ${p.text.trim()}`)
    }

    return parts.join('\n\n')
}

function isProjectMarkdownPage(block: NotionBlock): boolean {
    return block.type === 'child_page' && block.child_page?.title?.trim().toLowerCase() === 'project.md'
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

/** Reads the "PROJECT.md" child page under the Config page — empty string if it doesn't exist yet. */
export async function fetchProjectMarkdown(): Promise<string> {
    const blocks = await fetchBlockChildren(CONFIG_PAGE_ID)
    const page = blocks.find(isProjectMarkdownPage)
    if (!page) return ''

    const children = await fetchBlockChildren(page.id)
    const codeBlock = children.find((b) => b.type === 'code')
    return codeBlock ? plainText(codeBlock.code?.rich_text) : ''
}

/** Rewrites the "PROJECT.md" child page under the Config page with `text`, creating the page first if needed. */
export async function saveProjectMarkdown(text: string): Promise<void> {
    const blocks = await fetchBlockChildren(CONFIG_PAGE_ID)
    const existing = blocks.find(isProjectMarkdownPage)
    const pageId = existing ? existing.id : await createChildPage(CONFIG_PAGE_ID, 'PROJECT.md')

    await replaceCodeBlock(pageId, 'markdown', text)
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
