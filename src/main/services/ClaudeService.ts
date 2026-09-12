import 'dotenv/config'
import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import { writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { EventEmitter } from 'node:events'
import { sessionCwd, sessionFilePath } from './SessionTranscript'

const noHooksSettingsPath = join(tmpdir(), 'spline-claude-settings.json')
writeFileSync(noHooksSettingsPath, JSON.stringify({ hooks: {} }))

/* Where the CLI lives, per platform. `.env` is machine-local, but it is written to be copied
   between the Windows and macOS checkouts: entries are home-relative rather than carrying a
   username, and `process.platform` picks which one applies. `SPLINE_CLAUDE_PATH` overrides both,
   for a machine that keeps it somewhere else again.

   On Windows this must be the real binary, not the `claude` on PATH — that is an npm-generated
   .cmd stub, and Windows cannot execute one of those without a shell. Going through a shell is
   what we are avoiding: it caps the command line at 8191 characters, eats newlines, and expands
   `%VAR%` inside the arguments, none of which survive contact with injected project text.

   On macOS an npm or pnpm install leaves a /bin/sh shim instead, which is harmless — it forwards
   `"$@"` unmodified, and `stopSession` ends a process by closing stdin, which the shim passes
   straight through. PATH is still no way to find it: a window opened from Finder inherits
   launchd's PATH, not the shell's. */
const FALLBACK_PATHS: Record<string, string[]> = {
    win32: [join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')],
    darwin: [
        join(homedir(), '.local', 'bin', 'claude'),
        join(homedir(), 'Library', 'pnpm', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude'
    ]
}

/** Expands a leading `~/`, so one `.env` can name a home directory on either machine. */
function expandHome(path: string): string {
    return path.startsWith('~/') ? join(homedir(), path.slice(2)) : path
}

/** The `.env` key this platform reads: `SPLINE_CLAUDE_PATH_WIN32` or `SPLINE_CLAUDE_PATH_DARWIN`. */
const PLATFORM_KEY = `SPLINE_CLAUDE_PATH_${process.platform.toUpperCase()}`

/* Probed rather than assumed, because the fallbacks only matter when there is no `.env` to read —
   a packaged build, where dotenv resolves against a cwd of `/`. The first entry is the last
   resort purely so a failure names a path. */
const fallbacks = FALLBACK_PATHS[process.platform] ?? []

const CLAUDE_EXE = expandHome(
    process.env.SPLINE_CLAUDE_PATH ??
        process.env[PLATFORM_KEY] ??
        fallbacks.find((path) => existsSync(path)) ??
        fallbacks[0] ??
        'claude'
)

/** Fails at startup rather than on the first send, where a missing binary would surface as a chat
    that silently never replies. */
export function assertClaudeExe(): void {
    if (!existsSync(CLAUDE_EXE)) {
        throw new Error(`claude binary missing at ${CLAUDE_EXE} — set ${PLATFORM_KEY} in .env`)
    }
}

const ALLOWED_TOOLS = [
    'WebSearch',
    'WebFetch',
    'mcp__claude_ai_Notion__notion-convert-page-to-skill',
    'mcp__claude_ai_Notion__notion-create-attachment',
    'mcp__claude_ai_Notion__notion-create-comment',
    'mcp__claude_ai_Notion__notion-create-database',
    'mcp__claude_ai_Notion__notion-create-file-upload',
    'mcp__claude_ai_Notion__notion-create-folder',
    'mcp__claude_ai_Notion__notion-create-pages',
    'mcp__claude_ai_Notion__notion-create-view',
    'mcp__claude_ai_Notion__notion-download-attachment',
    'mcp__claude_ai_Notion__notion-duplicate-page',
    'mcp__claude_ai_Notion__notion-fetch',
    'mcp__claude_ai_Notion__notion-get-async-task',
    'mcp__claude_ai_Notion__notion-get-comments',
    'mcp__claude_ai_Notion__notion-get-teams',
    'mcp__claude_ai_Notion__notion-get-users',
    'mcp__claude_ai_Notion__notion-list-favorite-pages',
    'mcp__claude_ai_Notion__notion-list-private-pages',
    'mcp__claude_ai_Notion__notion-list-recent-pages',
    'mcp__claude_ai_Notion__notion-list-shared-pages',
    'mcp__claude_ai_Notion__notion-move-pages',
    'mcp__claude_ai_Notion__notion-query-data-sources',
    'mcp__claude_ai_Notion__notion-query-database-view',
    'mcp__claude_ai_Notion__notion-query-meeting-notes',
    'mcp__claude_ai_Notion__notion-search',
    'mcp__claude_ai_Notion__notion-search-agents',
    'mcp__claude_ai_Notion__notion-update-data-source',
    'mcp__claude_ai_Notion__notion-update-page',
    'mcp__claude_ai_Notion__notion-update-view'
].join(' ')

/* Which built-in tools exist at all, as opposed to `--allowedTools`, which only says which of them
   may run without asking. The difference is what it costs: every tool the CLI carries ships its
   full schema in the system prompt on every turn, whether or not the chat is allowed to call it.
   The default set is 32 tools — Bash, the file editors, Task, the todo list — and none of them are
   allowed here, so they were ~20k tokens per turn buying nothing. Measured against this binary: 32
   tools cost 30.2k, these two cost 10.0k. */
const BUILTIN_TOOLS = 'WebSearch,WebFetch'

interface ResultEvent {
    type: 'result'
    is_error: boolean
    result?: string
}

/** Emits `{ sessionId, event }` for every parsed stream-json line, unfiltered,
    `{ sessionId, status }` on 'status' as a chat's process comes up or goes away, and
    `{ sessionId, line }` on 'debug' for everything sent to the CLI — the spawn command and every
    stdin write — plain text for the debug terminal in the chat UI. The id is what lets the
    renderer route any of these to the chat they belong to — several sessions run at once. */
export const claudeEvents = new EventEmitter()

function emitDebug(sessionId: string, line: string): void {
    claudeEvents.emit('debug', { sessionId, line })
}

/** `idle` — no process. `booting` — spawned, nothing heard back yet. `ready` — the CLI has spoken. */
export type SessionStatus = 'idle' | 'booting' | 'ready'

interface Session {
    proc: ChildProcessWithoutNullStreams
    buffer: string
    queue: Array<{ resolve: (value: string) => void; reject: (error: Error) => void }>
    /** What this process was spawned with — a change means it has to be replaced. */
    model: string
    effort: string
    systemPrompt: string
    /** True until the CLI produces its first line. Boot takes over a second from cold, and
        longer when `--resume` has a large transcript to replay. */
    booting: boolean
}

/** Used for chats whose row carries no preference yet, and for the voice session, which has no row. */
export const DEFAULT_MODEL = 'opus'
export const DEFAULT_EFFORT = 'high'

/** One live CLI process per chat, keyed by the chat's session id. Processes stay up until the
    chat is closed or the app quits; conversation state lives in the CLI's own session
    transcript, so killing one loses nothing that `--resume` cannot restore. */
const sessions = new Map<string, Session>()

function setStatus(sessionId: string, status: SessionStatus): void {
    claudeEvents.emit('status', { sessionId, status })
}

/** Current status of every chat with a live process — everything else is `idle`. Lets a renderer
    that started late paint the right state without waiting for the next transition. */
export function getSessionStatuses(): Record<string, SessionStatus> {
    return Object.fromEntries([...sessions].map(([id, s]) => [id, s.booting ? 'booting' : 'ready']))
}

/* Appended context travels as a file rather than as an argument. The CLI reads it at spawn — a
   rewrite under a live process changes nothing until that process is replaced, which is exactly
   the refresh model the app wants. One file per chat, so concurrent sessions cannot overwrite
   each other's context. */
function systemPromptPath(sessionId: string): string {
    return join(tmpdir(), `spline-system-prompt-${sessionId}.txt`)
}

function clearSystemPromptFile(sessionId: string): void {
    rmSync(systemPromptPath(sessionId), { force: true })
}

/** Writes the file and returns the flags that point at it — empty when there is nothing to append,
    so a chat with no attached projects spawns exactly as it did before. */
function systemPromptArgs(sessionId: string, systemPrompt: string): string[] {
    if (!systemPrompt.trim()) {
        clearSystemPromptFile(sessionId)
        return []
    }

    const path = systemPromptPath(sessionId)
    writeFileSync(path, systemPrompt, 'utf8')
    emitDebug(sessionId, `--append-system-prompt-file ${path}:\n${systemPrompt}`)
    return ['--append-system-prompt-file', path]
}

function handleLine(sessionId: string, session: Session, line: string): void {
    if (!line.trim()) return

    /* Output from a process that has already been replaced belongs to a conversation turn nobody
       is waiting on any more — attributing it to the live session would clear its booting flag and
       settle its queue with a stale result. */
    if (sessions.get(sessionId) !== session) return

    let event: Record<string, unknown>
    try {
        event = JSON.parse(line) as Record<string, unknown>
    } catch {
        return
    }

    /* Any line at all proves the CLI is up — the first one is a startup `system` message, well
       before the model replies, so the indicator clears honestly rather than tracking the turn. */
    if (session.booting) {
        session.booting = false
        setStatus(sessionId, 'ready')
    }

    claudeEvents.emit('event', { sessionId, event })

    if (event.type !== 'result') return

    const pending = session.queue.shift()
    if (!pending) return

    const result = event as unknown as ResultEvent
    if (result.is_error) pending.reject(new Error(result.result ?? 'Claude request failed'))
    else pending.resolve(result.result ?? '')
}

function ensureSession(sessionId: string, model: string, effort: string, systemPrompt: string): Session {
    const existing = sessions.get(sessionId)
    /* Model, effort and the appended system prompt are all fixed at spawn, so changing any of them
       means replacing the process. The conversation is unaffected: the replacement resumes the same
       session transcript, and the CLI rebuilds its system prompt from the flags each time rather
       than restoring whatever the session started with. */
    if (existing && existing.model === model && existing.effort === effort && existing.systemPrompt === systemPrompt) {
        return existing
    }
    if (existing) stopSession(sessionId)

    /* A session file on disk means the CLI already knows this id, so it must be resumed rather
       than declared. Deriving that from the file (instead of tracking a flag) survives an app
       restart, and self-heals if the transcript was cleaned up under us. */
    const resuming = existsSync(sessionFilePath(sessionId))

    const args = [
        '-p',
        '--input-format', 'stream-json',
        '--output-format', 'stream-json',
        /* Text arrives as it is generated rather than only in the final `result`. It costs nothing
           at the API — the CLI already receives a stream — and it is what lets the reply type into
           the bubble and be read aloud from the first finished sentence. Fixed at spawn like
           `--model`, so it is unconditional: making it follow voice mode would mean replacing the
           process on every toggle. */
        '--include-partial-messages',
        '--tools', BUILTIN_TOOLS,
        '--allowedTools', ALLOWED_TOOLS,
        '--verbose',
        /* Drops cwd, env info, memory paths and git status from the system prompt. A chat app has
           no use for any of it, and it is charged on every turn of every session. */
        '--exclude-dynamic-system-prompt-sections',
        '--model', model,
        '--effort', effort,
        '--settings', noHooksSettingsPath,
        /* Written before the spawn, never after: the CLI reads the file as it starts, so a later
           write would land too late for this process and leave it running stale context. */
        ...systemPromptArgs(sessionId, systemPrompt),
        ...(resuming ? ['--resume', sessionId] : ['--session-id', sessionId])
    ]

    emitDebug(sessionId, `$ ${CLAUDE_EXE} ${args.join(' ')}`)

    const proc = spawn(CLAUDE_EXE, args, { cwd: sessionCwd() })
    proc.stdout.setEncoding('utf8')

    const session: Session = { proc, buffer: '', queue: [], model, effort, systemPrompt, booting: true }

    proc.stdout.on('data', (chunk: string) => {
        session.buffer += chunk
        let newlineIndex: number
        while ((newlineIndex = session.buffer.indexOf('\n')) >= 0) {
            const line = session.buffer.slice(0, newlineIndex)
            session.buffer = session.buffer.slice(newlineIndex + 1)
            handleLine(sessionId, session, line)
        }
    })

    /* Both endings land here: a normal exit, and a spawn failure. Spawning the binary directly
       means a missing or broken one now raises `error` — under `shell: true` it could not, because
       the shell itself started fine and merely exited non-zero. `error` may fire without any
       `exit` following it, so the teardown has to be shared or a failed spawn would leave the chat
       registered and waiting on a promise that never settles. */
    const teardown = (reason: string): void => {
        /* A model or effort switch replaces the process, and the outgoing one ends after its
           replacement is already registered. Without this guard that late ending would evict the
           live session from the map and report the chat as idle while it is starting up. */
        if (sessions.get(sessionId) !== session) return

        sessions.delete(sessionId)
        if (session.booting) console.error(`[claude] session ${sessionId} ${reason} during startup`)
        setStatus(sessionId, 'idle')
        session.queue.splice(0).forEach((p) => p.reject(new Error(`Claude process ${reason}`)))
    }

    proc.on('exit', (code) => teardown(`exited (code ${code})`))

    proc.on('error', (error) => {
        console.error(`[claude] session ${sessionId} failed to spawn:`, error)
        teardown('failed to spawn')
    })

    sessions.set(sessionId, session)
    setStatus(sessionId, 'booting')
    return session
}

export function askClaude(
    sessionId: string,
    prompt: string,
    model: string = DEFAULT_MODEL,
    effort: string = DEFAULT_EFFORT,
    systemPrompt: string = ''
): Promise<string> {
    const session = ensureSession(sessionId, model, effort, systemPrompt)

    return new Promise((resolve, reject) => {
        session.queue.push({ resolve, reject })

        const message = {
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: prompt }] }
        }
        const line = JSON.stringify(message) + '\n'
        emitDebug(sessionId, line.trimEnd())
        session.proc.stdin.write(line)
    })
}

/** One-off, isolated headless call — its own process, no shared queue, always haiku, and
    explicitly not persisted so it never litters the transcript directory with pseudo-chats. */
export function generateChatTitle(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const args = [
            '-p',
            '--input-format', 'stream-json',
            '--output-format', 'stream-json',
            '--verbose',
            '--exclude-dynamic-system-prompt-sections',
            /* Naming a chat needs no tools and no connectors, and both are charged by the token:
               with the defaults this one-line call was carrying 32 built-in schemas and every
               MCP server the account has connected — measured at ~62k tokens to produce a title.
               Empty `--tools` plus strict MCP takes the same call to ~3k. */
            '--tools', '',
            '--strict-mcp-config',
            '--model', 'haiku',
            '--no-session-persistence',
            '--settings', noHooksSettingsPath
        ]

        const proc = spawn(CLAUDE_EXE, args, { cwd: sessionCwd() })
        proc.stdout.setEncoding('utf8')
        let buf = ''
        let settled = false

        proc.stdout.on('data', (chunk: string) => {
            buf += chunk
            let newlineIndex: number
            while ((newlineIndex = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, newlineIndex)
                buf = buf.slice(newlineIndex + 1)
                if (!line.trim()) continue
                /* A line that will not parse is skipped, the same way `handleLine` skips one. Left
                   unguarded the throw escapes into the stream's 'data' event, where it is an
                   uncaught exception rather than a rejection — the promise never settles, and the
                   chat keeps its placeholder title with nothing explaining why. */
                let event: Record<string, unknown>
                try {
                    event = JSON.parse(line) as Record<string, unknown>
                } catch {
                    continue
                }

                if (event.type !== 'result') continue

                settled = true
                const result = event as unknown as ResultEvent
                if (result.is_error) reject(new Error(result.result ?? 'Chat title generation failed'))
                else resolve(result.result ?? '')
                proc.stdin.end()
            }
        })

        proc.on('error', (error) => {
            /* Marked settled so the exit that follows does not replace this with the vaguer
               'exited early' — a failure to spawn should say so. */
            settled = true
            reject(error)
        })
        proc.on('exit', () => {
            if (!settled) reject(new Error('Chat title process exited early'))
        })

        const message = {
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: prompt }] }
        }
        proc.stdin.write(JSON.stringify(message) + '\n')
    })
}

/** Ends one chat's process. The conversation is unaffected — the next send resumes it from
    the session transcript. */
export function stopSession(sessionId: string): void {
    const session = sessions.get(sessionId)
    if (!session) return
    session.proc.stdin.end()
    sessions.delete(sessionId)
    /* Safe even mid-replacement: the CLI read the file at spawn, and `ensureSession` rewrites it
       before starting the successor. */
    clearSystemPromptFile(sessionId)
    setStatus(sessionId, 'idle')
}

export function stopAllSessions(): void {
    for (const id of [...sessions.keys()]) stopSession(id)
}

/** Swaps a running chat onto a new model or effort straight away, rather than waiting for its next
    send. Model and effort are spawn arguments, so this means replacing the process — it resumes the
    same session transcript, so the conversation carries over intact. */
export function restartSession(sessionId: string, model: string, effort: string, systemPrompt?: string): void {
    const existing = sessions.get(sessionId)

    /* Nothing running: leave it idle. Spawning here would start a process for a chat the user is
       only configuring, and the next send picks up the new flags anyway. */
    if (!existing) return

    /* Omitted means "only the pickers changed" — keep whatever context the process already has,
       rather than silently dropping it because this caller had nothing to say about it. */
    const nextSystemPrompt = systemPrompt ?? existing.systemPrompt
    if (existing.model === model && existing.effort === effort && existing.systemPrompt === nextSystemPrompt) return

    /* Mid-turn: killing the process now would reject the reply the user is waiting on. Leave it,
       and let `ensureSession` do the swap on the next send once this turn has landed. */
    if (existing.queue.length > 0) return

    stopSession(sessionId)
    ensureSession(sessionId, model, effort, nextSystemPrompt)
}
