/* Markdown as the wire format for a page's body, in both directions.

   The app edits a page as text and Notion stores it as blocks, so one of the two has to convert.
   Doing it here, symmetrically, is what makes the round trip lossless: every block type the app can
   render has a markdown spelling, and every markdown spelling maps back to exactly that block. Save
   a page, reopen it, and it comes back the way it was written.

   Block level only — no bold, italic or links. Those live inside a block's `rich_text` and would
   need the annotations carried through the whole read path, which is a separate change. Until then
   `**bold**` survives as literal asterisks rather than being silently eaten.

   The supported set is deliberately the same one `toDetailBlock` recognises and the views render.
   Anything Notion offers beyond it — toggles, callouts, columns — has no spelling here, and is left
   alone rather than flattened: `rewritePageBody` only ever deletes the block types this module
   writes, so a page carrying one of those keeps it through a save it was not part of. */

export type MarkdownBlockType =
    | 'heading_1'
    | 'heading_2'
    | 'heading_3'
    | 'paragraph'
    | 'bulleted_list_item'
    | 'numbered_list_item'
    | 'to_do'
    | 'quote'
    | 'code'
    | 'divider'
    | 'image'
    | 'table'

export interface MarkdownBlock {
    type: MarkdownBlockType
    text: string
    /** `to_do` only. */
    checked?: boolean
    /** `image` only: where the picture is. */
    url?: string
    /** `table` only: every row, the header included when there is one, each the same length. */
    rows?: string[][]
    /** `table` only: whether the first of `rows` is the column header. */
    hasColumnHeader?: boolean
}

const FENCE = '```'
const NEWLINE = String.fromCharCode(10)

/* Checked before the bullet rule: a to-do is a bullet with a box, so `- [ ] x` matches both. */
const TODO = /^[-*]\s+\[([ xX])\]\s?(.*)$/
const BULLET = /^[-*]\s+(.*)$/
const NUMBERED = /^\d+\.\s+(.*)$/
const HEADING = /^(#{1,3})\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const DIVIDER = /^(-{3,}|\*{3,}|_{3,})$/
/* An image is the one block whose content is not its text: the caption is the alt, and the url is
   what actually has to survive the round trip. Written on a line of its own, the way Notion holds
   it — an image inside a paragraph has no block to be.

   The url runs greedily to the last `)` on the line rather than stopping at the first, because urls
   have parentheses in them: a file called `Screenshot (1).png` keeps its brackets through Notion's
   storage, and stopping early left the whole line unmatched and written back as literal text. The
   caption is read lazily for the same reason from the other end — a bracket in a caption used to
   cost the image the same way. */
const IMAGE = /^!\[(.*?)\]\((.+)\)$/

/* A table is the second multi-line spelling, after the code fence, and the only one that is a grid
   rather than a run of lines. Written the way GitHub writes one — a header row, a row of dashes
   under it, then the body — because that is what a person editing the page in a textarea already
   knows how to type, and what the model reads without being told.

   Two things Notion holds have no spelling and do not survive: a cell's line breaks, replaced by a
   space, since a markdown row is one line; and `has_row_header`, the flag that makes the first
   column bold, which GFM has no way to say at all and which is written back off. Both are the same
   trade the module makes for bold and italic — block level only.

   The one thing the spelling cannot decide is a paragraph that begins with a pipe sitting directly
   under a table: there is nothing to tell it from another row, and it is read as one. A paragraph
   that merely contains a pipe is safe, and so is a second table — see the bounds on the body loop
   in `markdownToBlocks`. Real GFM is ambiguous here in exactly the same way. */
const DELIMITER_CELL = /^:?-+:?$/

/** The row of dashes under a header, which is the thing that makes the lines around it a table
    rather than a paragraph with pipes in it. Alignment colons are accepted and then ignored: this
    module never writes them, but a table pasted in from elsewhere carries them. */
function isDelimiterRow(line: string): boolean {
    if (!hasUnescapedPipe(line)) return false
    const cells = splitRow(line)
    return cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell))
}

/** Whether a line has a `|` that is not escaped — what makes it a candidate row. */
function hasUnescapedPipe(line: string): boolean {
    for (let i = 0; i < line.length; i++) {
        if (line[i] === '\\') i++
        else if (line[i] === '|') return true
    }
    return false
}

/* A cell's text sits between pipes, so a pipe inside one has to be escaped or the row would read as
   having a column more than it does. The backslash goes first, or escaping the pipe would produce a
   sequence the unescape below could not tell from an escaped backslash followed by a bare pipe. */
function escapeCell(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function unescapeCell(text: string): string {
    return text.replace(/\\([\\|])/g, '$1')
}

/** The cells of one row, split on the pipes that are not escaped.

    The outer pipes are optional in the spelling and always written by this module, so the empty
    piece either side of them is dropped — a row that does start with a genuinely empty cell still
    reads back as one, because that cell's own pipe is what bounds it. */
function splitRow(line: string): string[] {
    const cells: string[] = []
    let current = ''

    for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '\\' && i + 1 < line.length) {
            current += char + line[i + 1]
            i++
        } else if (char === '|') {
            cells.push(current)
            current = ''
        } else {
            current += char
        }
    }
    cells.push(current)

    if (cells.length > 0 && cells[0].trim() === '') cells.shift()
    if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop()

    return cells.map((cell) => unescapeCell(cell.trim()))
}

/** Notion takes a table only if every row is exactly as wide as the table, so a row written short or
    long is padded or trimmed rather than costing the whole block. */
function fitRow(cells: string[], width: number): string[] {
    const row = cells.slice(0, width)
    while (row.length < width) row.push('')
    return row
}

/** A table's lines, header included. The one place the spelling is defined, so the editor, the
    injected context and the parser above all agree on what a table looks like. */
export function tableToMarkdown(rows: string[][], hasColumnHeader: boolean): string[] {
    const width = Math.max(1, ...rows.map((row) => row.length))
    const line = (cells: string[]): string => `| ${fitRow(cells, width).map(escapeCell).join(' | ')} |`

    /* GFM has to have a header row and Notion need not, so a table without one is written with a
       blank header — which is exactly what the parser reads back as its absence. */
    const header = hasColumnHeader ? (rows[0] ?? []) : []
    const body = hasColumnHeader ? rows.slice(1) : rows

    return [line(header), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)]
}

/** Parses an edited body into the blocks Notion should hold. */
export function markdownToBlocks(text: string): MarkdownBlock[] {
    const lines = text.split('\n')
    const blocks: MarkdownBlock[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const trimmed = line.trim()

        /* Fenced code first: everything up to the closing fence is content, not markdown. A label
           after the opening fence is read and dropped — Notion validates code languages against a
           fixed list, and nothing here needs highlighting. */
        if (trimmed.startsWith(FENCE)) {
            const body: string[] = []
            i++
            while (i < lines.length && !lines[i].trim().startsWith(FENCE)) {
                body.push(lines[i])
                i++
            }
            blocks.push({ type: 'code', text: body.join(NEWLINE) })
            continue
        }

        /* The other multi-line spelling, and the reason the delimiter under the header has to carry
           a pipe of its own: a paragraph that happens to contain one, followed by the `---` of a
           divider, would otherwise be swallowed as a table two lines wide. */
        const delimiter = i + 1 < lines.length ? lines[i + 1].trim() : ''
        if (hasUnescapedPipe(trimmed) && isDelimiterRow(delimiter) && splitRow(trimmed).length > 0) {
            const header = splitRow(trimmed)
            const body: string[][] = []
            /* Where the body stops. A table's rows are bounded the way its header was: this module
               always writes the outer pipes, so a header that has them makes a line without them —
               a paragraph that merely contains a pipe — the end of the table rather than another
               row of it. A header written without them, which only a person typing by hand
               produces, falls back to accepting any line with a pipe in it. */
            const outerPiped = trimmed.startsWith('|')

            let j = i + 2
            while (j < lines.length) {
                const row = lines[j].trim()
                if (!row || !hasUnescapedPipe(row)) break
                if (outerPiped && !row.startsWith('|')) break
                /* A row with a delimiter under it is the header of the next table, not a row of
                   this one — two tables written back to back would otherwise be read as one, with
                   the second's dashes landing in the first as data. */
                if (isDelimiterRow(j + 1 < lines.length ? lines[j + 1].trim() : '')) break
                body.push(splitRow(row))
                j++
            }
            i = j - 1

            /* An all-blank header is how a table with no column header is written — see
               `tableToMarkdown` — so it is read back as one rather than as a row of empty cells. */
            const hasColumnHeader = header.some((cell) => cell !== '')
            const rows = (hasColumnHeader ? [header, ...body] : body).map((row) =>
                fitRow(row, header.length)
            )
            /* Notion will not take a table with no rows at all, and an unheaded table written with
               nothing under it is exactly that. */
            if (rows.length === 0) rows.push(fitRow([], header.length))

            blocks.push({ type: 'table', text: '', rows, hasColumnHeader })
            continue
        }

        if (DIVIDER.test(trimmed)) {
            blocks.push({ type: 'divider', text: '' })
            continue
        }

        const image = IMAGE.exec(trimmed)
        if (image) {
            blocks.push({ type: 'image', text: image[1], url: image[2] })
            continue
        }

        const heading = HEADING.exec(trimmed)
        if (heading) {
            const level = heading[1].length as 1 | 2 | 3
            blocks.push({ type: `heading_${level}` as MarkdownBlockType, text: heading[2] })
            continue
        }

        const todo = TODO.exec(trimmed)
        if (todo) {
            blocks.push({ type: 'to_do', text: todo[2], checked: todo[1].toLowerCase() === 'x' })
            continue
        }

        const bullet = BULLET.exec(trimmed)
        if (bullet) {
            blocks.push({ type: 'bulleted_list_item', text: bullet[1] })
            continue
        }

        const numbered = NUMBERED.exec(trimmed)
        if (numbered) {
            blocks.push({ type: 'numbered_list_item', text: numbered[1] })
            continue
        }

        const quote = QUOTE.exec(trimmed)
        if (quote) {
            blocks.push({ type: 'quote', text: quote[1] })
            continue
        }

        /* A blank line is kept as an empty paragraph so the spacing a person typed survives the
           round trip rather than being collapsed on every save. */
        blocks.push({ type: 'paragraph', text: line })
    }

    return blocks
}

/** The inverse: what the editor shows for a page Notion already holds. */
export function blocksToMarkdown(
    blocks: Array<{
        type: string
        text: string
        checked?: boolean
        url?: string
        rows?: string[][]
        hasColumnHeader?: boolean
    }>
): string {
    const lines: string[] = []
    /* Notion holds a numbered list as a run of items and no numbers — the position in the run is the
       number. Counting the run back is what makes an edited list read `1. 2. 3.` rather than `1.`
       three times over. Anything that is not another item ends the run, the same way it does in
       Notion, where a paragraph between two lists restarts the second at one. */
    let ordinal = 0

    for (const block of blocks) {
        if (block.type === 'numbered_list_item') ordinal += 1
        else ordinal = 0

        switch (block.type) {
            case 'heading_1':
                lines.push(`# ${block.text}`)
                break
            case 'heading_2':
                lines.push(`## ${block.text}`)
                break
            case 'heading_3':
                lines.push(`### ${block.text}`)
                break
            case 'bulleted_list_item':
                lines.push(`- ${block.text}`)
                break
            case 'numbered_list_item':
                lines.push(`${ordinal}. ${block.text}`)
                break
            case 'to_do':
                lines.push(`- [${block.checked ? 'x' : ' '}] ${block.text}`)
                break
            case 'quote':
                lines.push(`> ${block.text}`)
                break
            case 'divider':
                lines.push('---')
                break
            case 'image':
                /* Shown rather than hidden, so an image is something a person editing the page can
                   see, move and delete like any other line. A picture with no url has nothing to
                   write and nothing to come back as, so it is left out entirely. */
                if (block.url) lines.push(`![${block.text}](${block.url})`)
                break
            case 'code': {
                lines.push(FENCE, ...block.text.split(NEWLINE), FENCE)
                break
            }
            case 'table':
                /* A table with no rows has nothing to write and would come back as a header of one
                   empty column, so it is left out the way an image with no url is. */
                if (block.rows && block.rows.length > 0) {
                    lines.push(...tableToMarkdown(block.rows, block.hasColumnHeader ?? false))
                }
                break
            default:
                lines.push(block.text)
        }
    }

    return lines.join('\n')
}
