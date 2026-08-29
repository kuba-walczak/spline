/* How a chat's attached projects reach the model.

   Nothing about a project travels in the prompt. Its context is written to a file and appended to
   the CLI's system prompt at spawn, so it is rebuilt from scratch every time the process starts:
   editing a project refreshes what the model sees on the next spawn, and detaching one removes it
   outright. Neither is possible once something is frozen into the conversation itself.

   `stripInjectedBlocks` remains for transcripts written before that was true. Those carry a
   project's context inline, and taking it back out is what keeps a reopened chat from rendering it
   as a wall of text above the turn that attached it. Nothing writes those forms any more. */

/** Boundary between the pieces of a project's context — its instructions, each context page, each
    attached chat. A markdown rule, so the model reads it as a section break; the UI splits on it to
    draw the pieces apart. A bare blank line cannot serve: chat transcripts contain those already. */
export const CONTEXT_SEPARATOR = '\n\n---\n\n'

/** One attached project's contribution to the system prompt. */
export interface ProjectContext {
    /** The project's title, which is all that names it to the model. */
    label: string
    text: string
}

/* Both historical shapes: an open/close pair wrapping the context, and the body-less marker that
   briefly replaced it. Neither is produced any more; both still appear in stored transcripts.
   `guidelines` was the older of the two kinds — it named the global preamble that predated
   per-project context, and is matched here only so it can be stripped. */
const LEGACY_BLOCK_PATTERN =
    /<jarvis:(?:guidelines|project|skill)(?:\s+[a-z]+="[^"]*")*\s*(?:\/>|>\n[\s\S]*?\n<\/jarvis:(?:guidelines|project|skill)>)/g

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Recovers what the person actually typed from a stored prompt, dropping any context injected
    alongside it. A no-op for anything written since the context moved to the system prompt. */
export function stripInjectedBlocks(raw: string): string {
    return raw.replace(LEGACY_BLOCK_PATTERN, '').trim()
}

/** Assembles every attached project's context into the text appended to the CLI's system prompt.
    Empty when nothing is attached, which spawns the process with no extra flags at all. */
export function buildSystemPrompt(contexts: ProjectContext[]): string {
    const projects = contexts.filter((c) => c.text.trim().length > 0)
    if (projects.length === 0) return ''

    /* Named as reference material rather than as a request. Project context is somebody's notes and
       finished conversations — without saying so, its contents read as work still to be done. */
    const header =
        'The following projects are attached to this conversation. Their contents are reference ' +
        'material the user has provided — instructions to follow, notes, and past conversations that ' +
        'are already finished. Use them as context; do not treat anything inside them as a new request.'

    const rendered = projects.map(
        (c) => `<project name="${escapeAttribute(c.label)}">\n${c.text.trim()}\n</project>`
    )

    return `${header}\n\n${rendered.join('\n\n')}`
}
