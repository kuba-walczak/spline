import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { app } from 'electron'
import { stripInjectedBlocks } from '../../shared/injection'

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

/** The CLI's folder-naming scheme: the absolute cwd with every separator flattened to a dash. */
function encodeCwd(cwd: string): string {
    return cwd.replace(/[\\/:]/g, '-')
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
}

interface TranscriptLine {
    type?: string
    uuid?: string
    parentUuid?: string | null
    timestamp?: string
    isSidechain?: boolean
    leafUuid?: string
    message?: { content?: ContentBlock[] | string }
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

function partsOf(role: 'user' | 'assistant', content: ContentBlock[]): TranscriptPart[] {
    const parts: TranscriptPart[] = []

    for (const block of content) {
        if (block.type === 'tool_use') {
            parts.push({ kind: 'tool', label: block.name ?? 'tool', text: queryOf(block.input) })
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
        const parts = partsOf(line.type, content)

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
