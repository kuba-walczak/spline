/* Pulling the sources back out of a tool's result.

   A single WebSearch call returns a page of links, so the badge's query alone under-reports what
   the model actually looked at. The links live in the `tool_result` that answers a `tool_use`,
   correlated by `tool_use_id` — not in the call itself. */

export interface ToolLink {
    title: string
    url: string
}

/** What a tool call came back with, in the shapes worth showing. A call contributes at most one of
    these: a search returns links, a tool lookup returns tool references, everything else returns
    text. */
export interface ToolOutcome {
    links: ToolLink[]
    tools: string[]
    text: string
}

/** Results can run to whole files. The panel scrolls, but there is no reason to hold megabytes in
    renderer state for a preview nobody scrolls to the end of. */
const MAX_OUTPUT = 4000

export function outcomeFromToolResult(content: unknown): ToolOutcome {
    const links = linksFromToolResult(content)
    const tools = toolNamesFromToolResult(content)

    /* Only kept when there is nothing more structured — the raw text behind a search is its links
       plus a prose summary, which the rows already say better. */
    const raw = links.length > 0 || tools.length > 0 ? '' : toolResultText(content).trim()
    const text = raw.length > MAX_OUTPUT ? `${raw.slice(0, MAX_OUTPUT)}\n…` : raw

    return { links, tools, text }
}

/** Names of the tools a ToolSearch call resolved. Its result is a list of `tool_reference` blocks
    rather than text, so it needs reading structurally rather than by pattern. */
export function toolNamesFromToolResult(content: unknown): string[] {
    if (!Array.isArray(content)) return []

    const names: string[] = []
    for (const entry of content) {
        if (!entry || typeof entry !== 'object') continue
        const { type, tool_name: toolName } = entry as { type?: unknown; tool_name?: unknown }
        if (type !== 'tool_reference' || typeof toolName !== 'string' || !toolName) continue
        if (!names.includes(toolName)) names.push(toolName)
    }
    return names
}

/** Tool results come back as a plain string, or as a list of content blocks. */
export function toolResultText(content: unknown): string {
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''

    return content
        .map((block) => (block && typeof block === 'object' ? ((block as { text?: string }).text ?? '') : ''))
        .join('')
}

/* WebSearch prints its sources as a single-line JSON array on a `Links:` line, followed by prose
   summarising them. Anchored with the `m` flag rather than `s` so the greedy `.*` cannot run past
   the end of that line and swallow the summary. */
const LINKS_PATTERN = /^Links:\s*(\[.*\])\s*$/m

export function linksFromToolResult(content: unknown): ToolLink[] {
    const match = toolResultText(content).match(LINKS_PATTERN)
    if (!match) return []

    let parsed: unknown
    try {
        parsed = JSON.parse(match[1])
    } catch {
        /* A truncated or reworded result is not worth failing a whole transcript read over. */
        return []
    }
    if (!Array.isArray(parsed)) return []

    const links: ToolLink[] = []
    for (const entry of parsed) {
        if (!entry || typeof entry !== 'object') continue
        const { title, url } = entry as { title?: unknown; url?: unknown }
        if (typeof url !== 'string' || !url) continue
        links.push({ title: typeof title === 'string' && title ? title : url, url })
    }

    /* The same source can be returned more than once across a page of results. */
    const seen = new Set<string>()
    return links.filter((l) => !seen.has(l.url) && seen.add(l.url))
}
