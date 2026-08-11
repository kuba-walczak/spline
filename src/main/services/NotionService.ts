import 'dotenv/config'

const NOTION_VERSION = '2025-09-03'
const CHAT_LOG_DATA_SOURCE_ID = 'efe919c7-c9c1-404e-ac41-2b5210790815'

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

export interface ChatTranscriptMessage {
    role: 'user' | 'assistant'
    text: string
}

interface NotionBlock {
    id: string
    type: string
    heading_3?: { rich_text: NotionRichText[] }
    paragraph?: { rich_text: NotionRichText[] }
    code?: { rich_text: NotionRichText[] }
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

export async function appendMessages(pageId: string, messages: ChatTranscriptMessage[]): Promise<void> {
    if (messages.length === 0) return

    const children = messages.flatMap((m) => [
        {
            object: 'block',
            type: 'heading_3',
            heading_3: { rich_text: [{ type: 'text', text: { content: m.role === 'user' ? 'You' : 'Assistant' } }] }
        },
        { object: 'block', type: 'paragraph', paragraph: { rich_text: toRichText(m.text) } }
    ])

    for (let i = 0; i < children.length; i += 100) {
        const res = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
            method: 'PATCH',
            headers: headers(),
            body: JSON.stringify({ children: children.slice(i, i + 100) })
        })
        if (!res.ok) throw new Error(`Notion append blocks failed: ${res.status} ${await res.text()}`)
    }
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

/**
 * Page body is a sequence of Heading-3 blocks each followed by the message's
 * text blocks, alternating user/assistant starting with the user, and reset
 * (but not re-alternated) across "## Run N" headings and dividers.
 */
export async function fetchChatTranscript(pageId: string): Promise<ChatTranscriptMessage[]> {
    const blocks = await fetchBlockChildren(pageId)
    const messages: ChatTranscriptMessage[] = []
    let current: ChatTranscriptMessage | null = null
    let nextRole: 'user' | 'assistant' = 'user'

    for (const block of blocks) {
        if (block.type === 'heading_3') {
            if (current) messages.push(current)
            current = { role: nextRole, text: '' }
            nextRole = nextRole === 'user' ? 'assistant' : 'user'
            continue
        }

        if (block.type === 'heading_2' || block.type === 'divider' || block.type === 'quote') {
            if (current) messages.push(current)
            current = null
            continue
        }

        if (!current) continue

        const text = block.type === 'code' ? plainText(block.code?.rich_text) : plainText(block.paragraph?.rich_text)
        if (text) current.text = current.text ? `${current.text}\n${text}` : text
    }

    if (current) messages.push(current)

    return messages
}
