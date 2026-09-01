import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'
import { stripInjectedBlocks } from '../../shared/injection'
import { outcomeFromToolResult, type ToolOutcome } from '../../shared/toolResults'
import { usageFromRecord } from '../../shared/tokenUsage'

/* Reads a chat back from the CLI's own session transcript.

   The CLI writes one append-only JSONL per session under ~/.claude/projects/<encoded-cwd>/,
   named for the session id. That file is the conversation — full user and assistant text,
   tool calls with their inputs, thinking blocks — so the app reads it directly rather than
   keeping a second, lossier copy of the same thing. */

/** Every session this app spawns runs from here, so its transcripts all land in one
    predictable directory. Without pinning it the folder name follows whatever cwd launched
    Electron, and `--resume` silently fails to find sessions written by an earlier run. */
export function sessionCwd(): string {
    const dir = join(app.getPath('userData'), 'sessions')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
}

/** The CLI's folder-naming scheme: every character that is not a letter or a digit becomes a
    dash. On Windows the only such characters in a userData path are the separators, which is why
    flattening `[\\/:]` was indistinguishable there; on macOS userData sits under
    `~/Library/Application Support/`, and that space has to fold too or none of the transcripts
    the CLI writes are ever found again — leaving every chat blank and, worse, sending the second
    spawn of a session down the `--session-id` path against an id the CLI already knows.

    The CLI additionally caps the encoded name at 200 characters and appends a hash of the original
    past that. Not reproduced here: the hash is Bun's, and `sessionCwd()` is a quarter of the cap. */
function encodeCwd(cwd: string): string {
    return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function sessionFilePath(sessionId: string): string {
    return join(homedir(), '.claude', 'projects', encodeCwd(sessionCwd()), `${sessionId}.jsonl`)
}

export interface TranscriptPart {
    kind: 'text' | 'tool'
    /** `text` for text parts, tool input digest for tools. */
    text: string
    /** Tool name, for `tool` parts. */
    label?: string
    /** What the call came back with, correlated from its `tool_result` — sources for a search,
        tool names for a lookup, plain text for everything else. */
    outcome?: ToolOutcome
}

export interface TranscriptMessage {
    role: 'user' | 'assistant'
    parts: TranscriptPart[]
}

interface ContentBlock {
    type: string
    text?: string
    name?: string
    input?: unknown
    /** Set on `tool_use`; the id a later `tool_result` answers. */
    id?: string
    tool_use_id?: string
    content?: unknown
}

interface TranscriptLine {
    type?: string
    uuid?: string
    parentUuid?: string | null
    timestamp?: string
    isSidechain?: boolean
    leafUuid?: string
    message?: { content?: ContentBlock[] | string; usage?: Record<string, unknown> }
}

/** Reduces a tool's input object down to just its values — no field names or braces. */
function queryOf(input: unknown): string {
    if (input === null || input === undefined) return ''
    if (typeof input !== 'object') return String(input)
    return Object.values(input as Record<string, unknown>)
        .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)))
        .join(' ')
}

/** Resolves the tip of the branch actually in play. Interactive sessions record it as
    `last-prompt.leafUuid`; headless (`-p`) ones don't write that line at all, so fall back to
    the newest node nothing else claims as a parent. Reading the file top to bottom instead
    would replay abandoned branches from any rewind as if they had happened. */
function findLeaf(lines: TranscriptLine[], byId: Map<string, TranscriptLine>): string | null {
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].type === 'last-prompt' && lines[i].leafUuid) return lines[i].leafUuid!
    }

    const claimed = new Set(lines.map((l) => l.parentUuid).filter((p): p is string => Boolean(p)))
    const tips = [...byId.values()].filter((l) => !claimed.has(l.uuid!))
    if (tips.length === 0) return null

    return tips.reduce((best, l) => ((l.timestamp ?? '') > (best.timestamp ?? '') ? l : best)).uuid ?? null
}

function partsOf(
    role: 'user' | 'assistant',
    content: ContentBlock[],
    outcomeByToolId: Map<string, ToolOutcome>
): TranscriptPart[] {
    const parts: TranscriptPart[] = []

    for (const block of content) {
        if (block.type === 'tool_use') {
            const outcome = block.id ? outcomeByToolId.get(block.id) : undefined
            parts.push({
                kind: 'tool',
                label: block.name ?? 'tool',
                text: queryOf(block.input),
                ...(outcome ? { outcome } : null)
            })
            continue
        }
        if (block.type !== 'text' || !block.text) continue

        /* Only the user side ever carried injected context, and only there does taking it back out
           matter — an assistant that quotes the sentinels is just quoting text. */
        if (role !== 'user') {
            parts.push({ kind: 'text', text: block.text })
            continue
        }

        const text = stripInjectedBlocks(block.text)
        if (text) parts.push({ kind: 'text', text })
    }

    return parts
}

/** Concatenates adjacent text so a reply split across lines reads as one block, not several. */
function mergeParts(parts: TranscriptPart[], incoming: TranscriptPart[]): TranscriptPart[] {
    const merged = parts.slice()
    for (const part of incoming) {
        const last = merged[merged.length - 1]
        if (part.kind === 'text' && last?.kind === 'text') merged[merged.length - 1] = { kind: 'text', text: last.text + part.text }
        else merged.push(part)
    }
    return merged
}

/** How much context this session was holding when it last replied, or `null` for a session that
    has not replied yet — or whose file the CLI has already cleaned up.

    The transcript records the API's own `usage` block on every assistant line, so a resumed chat
    can show its context meter immediately instead of waiting for the first reply of the new run to
    report one. It is last run's number: the prefix is rebuilt at spawn from whatever flags apply
    now, so a model, effort or project change moves it. The first reply corrects it.

    Read in file order rather than by walking the reply chain, and sidechains skipped — a subagent's
    turn carries its own usage, and seeding the chat with that would read as a context that shrank. */
export function readSessionContextTokens(sessionId: string): number | null {
    const path = sessionFilePath(sessionId)
    if (!existsSync(path)) return null

    let latest: number | null = null
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
        if (!raw.trim()) continue

        let line: TranscriptLine
        try {
            line = JSON.parse(raw) as TranscriptLine
        } catch {
            continue
        }

        if (line.type !== 'assistant' || line.isSidechain) continue

        const usage = usageFromRecord(line.message?.usage)
        if (usage) latest = usage.total
    }

    return latest
}

/** Rebuilds a conversation from its session transcript. Empty when the session file is gone —
    the CLI deletes them on a rolling window (`cleanupPeriodDays`). */
export function readSessionTranscript(sessionId: string): TranscriptMessage[] {
    const path = sessionFilePath(sessionId)
    if (!existsSync(path)) return []

    const lines: TranscriptLine[] = []
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
        if (!raw.trim()) continue
        try {
            lines.push(JSON.parse(raw) as TranscriptLine)
        } catch {
            /* A session being written to can end mid-line; a torn tail is not a corrupt file. */
        }
    }

    const byId = new Map<string, TranscriptLine>()
    for (const line of lines) if (line.uuid) byId.set(line.uuid, line)

    /* Gathered from every line rather than from the branch walked below. Parallel tool calls have
       their results recorded as siblings — each `tool_result` hangs off the `tool_use` it answers,
       so only one of them lies on any single path. Reading them off the chain would show the
       sources for one search and silently drop the rest. */
    const outcomeByToolId = new Map<string, ToolOutcome>()
    for (const line of lines) {
        const raw = line.message?.content
        if (!Array.isArray(raw)) continue
        for (const block of raw) {
            if (block.type !== 'tool_result' || !block.tool_use_id) continue
            const outcome = outcomeFromToolResult(block.content)
            if (outcome.links.length > 0 || outcome.tools.length > 0 || outcome.text) {
                outcomeByToolId.set(block.tool_use_id, outcome)
            }
        }
    }

    const chain: TranscriptLine[] = []
    let cursor = findLeaf(lines, byId)
    const guard = new Set<string>()
    while (cursor && byId.has(cursor) && !guard.has(cursor)) {
        guard.add(cursor)
        chain.push(byId.get(cursor)!)
        cursor = byId.get(cursor)!.parentUuid ?? null
    }
    chain.reverse()

    const messages: TranscriptMessage[] = []
    for (const line of chain) {
        if (line.type !== 'user' && line.type !== 'assistant') continue
        if (line.isSidechain) continue

        const raw = line.message?.content
        const content: ContentBlock[] = typeof raw === 'string' ? [{ type: 'text', text: raw }] : raw ?? []
        const parts = partsOf(line.type, content, outcomeByToolId)

        /* A `user` line holding only tool_result is the harness feeding a tool's output back,
           not a turn the person took — it must not render as a user bubble. */
        if (parts.length === 0) continue

        /* One reply spans several assistant lines — a tool call, its result, then the text.
           Folding them back into a single message is what makes a reopened chat render the same
           way it did live, where the stream accumulates all of it into one bubble. */
        const previous = messages[messages.length - 1]
        if (previous?.role === line.type) {
            previous.parts = mergeParts(previous.parts, parts)
            continue
        }

        messages.push({ role: line.type, parts })
    }

    return messages
}
