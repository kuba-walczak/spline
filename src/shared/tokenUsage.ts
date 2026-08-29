/* How full a chat's context window is.

   The CLI already tells us: every `assistant` line of its stream-json output carries the `usage`
   block the API returned for that call, and the app forwards every line to the renderer. So this is
   read off traffic that is already flowing — nothing extra is sent, nothing is billed, and the
   transcript stays clean. Asking the CLI itself (a `/context` turn) would cost a real request per
   message and come back as prose to scrape.

   The last `assistant` event of a turn is the one to read. `result.usage` sums every model call the
   turn made, so an agentic turn with five tool round-trips reports about five times the context it
   actually holds; the final call's own numbers are the context as the model last saw it. */

/** Tokens the model was holding at the moment of one API call: everything it read, plus what it
    wrote — the write lands in the next call's input. */
export interface ContextUsage {
    /** Fresh input tokens — the part of the prompt that missed the cache. */
    input: number
    /** Prompt tokens served from the cache. Counted: they occupy the window like any other. */
    cacheRead: number
    /** Prompt tokens written into the cache this call. Also in the window. */
    cacheCreation: number
    output: number
    /** What the bar measures: the four above, added up. */
    total: number
}

/** The window the models this app offers expose. A constant rather than something read per chat:
    Opus and Sonnet are both 1M, so the only model that would move it is Haiku, at 200k — a chat on
    Haiku reads its bar as emptier than it is. */
export const CONTEXT_WINDOW = 1_000_000

function count(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Reads a `usage` block, from wherever it came — the live stream, or a session transcript on disk,
    which records the same object per assistant message. */
export function usageFromRecord(usage: Record<string, unknown> | undefined): ContextUsage | null {
    if (!usage) return null

    const input = count(usage.input_tokens)
    const cacheRead = count(usage.cache_read_input_tokens)
    const cacheCreation = count(usage.cache_creation_input_tokens)
    const output = count(usage.output_tokens)
    const total = input + cacheRead + cacheCreation + output

    /* A call that reports nothing at all is a malformed or placeholder usage block, and painting a
       0% bar over a real reading would look like the context had been cleared. */
    return total > 0 ? { input, cacheRead, cacheCreation, output, total } : null
}

/** Reads one stream-json event, and returns the context it reports — or `null` for the events that
    report none, which is most of them. */
export function usageFromEvent(event: Record<string, unknown>): ContextUsage | null {
    if (event.type !== 'assistant') return null

    return usageFromRecord((event.message as { usage?: Record<string, unknown> } | undefined)?.usage)
}

/** 0–1, clamped: a turn can overshoot the window slightly with its output before compaction. */
export function usageFraction(total: number, window = CONTEXT_WINDOW): number {
    return Math.min(1, Math.max(0, total / window))
}

/** "820", "12.4k", "148k", "1M" — the readout beside the bar, where a full count would be noise. */
export function formatTokens(value: number): string {
    if (value < 1000) return String(Math.round(value))
    if (value < 100_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
    if (value < 1_000_000) return `${Math.round(value / 1000)}k`
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}
