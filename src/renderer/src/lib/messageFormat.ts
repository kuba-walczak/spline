/* The markdown a chat bubble renders: headings, bold, and the code runs that must not be mistaken
   for either.

   Two layers, in that order. `messageBlocks` cuts the message into lines and lifts out the ones
   that are headings; `inlineSegments` runs inside whatever is left over. The layering is what keeps
   a `#` honest — it is a heading at the start of a line and a comment inside a fence, and only the
   line layer is in a position to know which.

   The CLI writes prose the way it writes everything else, with `**bold**` and `## headings` in it,
   and a bubble that renders its text verbatim showed the markers. What is handled is what the CLI
   actually reaches for often enough to trip a reader up; the rest of markdown — lists, tables,
   links — is left as written, because a reply is one stream of text rather than a page of blocks
   and a half-built renderer is worse than none. `shared/markdown.ts` is the block-level one, and
   it converts for Notion rather than for the screen.

   Two rules make it safe to run over a reply as it streams:

   - A marker only ever disappears once its pair has arrived. `**bold` half-written reads as literal
     asterisks until the closing pair lands, so nothing flickers between plain and bold mid-word.
   - Code is never touched. A fenced block or a backtick span is copied through verbatim, because
     `**` inside one is a C dereference or a glob, not emphasis — and a coding CLI writes far more of
     those than it writes bold words. */

/** One run of a message's text, and whether it is emphasised. */
export interface InlineSegment {
    text: string
    bold: boolean
}

const FENCE = '```'
const BACKTICK = '`'

/* Content is bounded by the nearest closing pair, has to start with something other than a space —
   `a ** b ** c` is arithmetic, not emphasis — and has to be non-empty, so `****` stays literal. */
const BOLD = /\*\*(?=[^\s*])([\s\S]*?[^\s*])\*\*/g

/** The end of the inline code span opening at `start`, or -1 if it never closes on that line.

    Bounded to the line the way markdown bounds one: an unpaired backtick in prose is a backtick,
    and letting it run to the end of the message would cost every bold word after it. */
function inlineCodeEnd(text: string, start: number): number {
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === BACKTICK) return i + 1
        if (text[i] === '\n') return -1
    }
    return -1
}

/** Splits `text` into its bold and plain runs, leaving code runs verbatim. */
export function inlineSegments(text: string): InlineSegment[] {
    const segments: InlineSegment[] = []

    const push = (value: string, bold: boolean): void => {
        if (!value) return
        /* Adjacent runs of the same weight are one span: the caller renders one element per
           segment, and a sentence split at every backtick would otherwise be a dozen of them. */
        const last = segments[segments.length - 1]
        if (last && last.bold === bold) last.text += value
        else segments.push({ text: value, bold })
    }

    /** Everything between two code runs: the only place emphasis is read. */
    const pushProse = (value: string): void => {
        let at = 0
        BOLD.lastIndex = 0
        let match: RegExpExecArray | null
        while ((match = BOLD.exec(value)) !== null) {
            push(value.slice(at, match.index), false)
            push(match[1], true)
            at = match.index + match[0].length
        }
        push(value.slice(at), false)
    }

    let i = 0
    let prose = 0

    while (i < text.length) {
        if (text.startsWith(FENCE, i)) {
            const close = text.indexOf(FENCE, i + FENCE.length)
            /* A fence still streaming has no close yet. Everything after it is code that has not
               finished arriving, so it goes through as written rather than being read as prose for
               the few hundred milliseconds before the closing fence shows up. */
            const end = close === -1 ? text.length : close + FENCE.length
            pushProse(text.slice(prose, i))
            push(text.slice(i, end), false)
            i = end
            prose = i
            continue
        }

        if (text[i] === BACKTICK) {
            const end = inlineCodeEnd(text, i)
            if (end !== -1) {
                pushProse(text.slice(prose, i))
                push(text.slice(i, end), false)
                i = end
                prose = i
                continue
            }
        }

        i++
    }

    pushProse(text.slice(prose))
    return segments
}

/** A message's text, cut into the pieces that are laid out differently. */
export type MessageBlock =
    | { kind: 'text'; segments: InlineSegment[] }
    | { kind: 'heading'; level: 1 | 2 | 3; segments: InlineSegment[] }

/* `#` up to three deep, and a space after it. The space is what separates a heading from the far
   more common things that start with a hash and are not one — `#include`, a `#1` in prose, a CSS
   colour. Deeper than three is still a heading, rendered as the smallest: a reply that reaches for
   `####` means a heading by it, and showing the hashes would be worse than showing it a size off. */
const HEADING = /^(#{1,6}) +(\S.*)$/

/** Whether a line opens or closes a fenced code block. */
function isFence(line: string): boolean {
    return line.trimStart().startsWith(FENCE)
}

/** Drops the blank lines at one end of a run of text.

    A heading carries its own space above and below, and the reply that wrote it almost always left
    a blank line there too. Rendering both is what turns an ordinary gap into a hole, so the blank
    lines touching a heading go and the margins do the spacing. */
function trimBlank(lines: string[], end: 'start' | 'end'): string[] {
    const out = lines.slice()
    if (end === 'start') while (out.length > 0 && out[0].trim() === '') out.shift()
    else while (out.length > 0 && out[out.length - 1].trim() === '') out.pop()
    return out
}

/** Splits a message into its headings and the text between them. */
export function messageBlocks(text: string): MessageBlock[] {
    const lines = text.split('\n')
    const blocks: MessageBlock[] = []
    let pending: string[] = []
    let inFence = false

    /* Text runs are held as lines rather than pushed as they come, because whether the run's last
       line is blank depends on what follows it — and that is not known until it arrives. */
    const flush = (beforeHeading: boolean): void => {
        let run = pending
        pending = []
        /* Only the edge touching a heading is trimmed. Blank lines anywhere else are the shape the
           reply was written in and are left exactly as they are. */
        if (blocks.length > 0 && blocks[blocks.length - 1].kind === 'heading') run = trimBlank(run, 'start')
        if (beforeHeading) run = trimBlank(run, 'end')
        if (run.length === 0) return
        blocks.push({ kind: 'text', segments: inlineSegments(run.join('\n')) })
    }

    for (const line of lines) {
        if (isFence(line)) inFence = !inFence

        /* Inside a fence every line is code, `# comment` included — which is most of the reason
           this layer exists at all. */
        const heading = inFence ? null : HEADING.exec(line)
        if (heading) {
            flush(true)
            const level = Math.min(3, heading[1].length) as 1 | 2 | 3
            blocks.push({ kind: 'heading', level, segments: inlineSegments(heading[2]) })
            continue
        }

        pending.push(line)
    }

    flush(false)
    return blocks
}
