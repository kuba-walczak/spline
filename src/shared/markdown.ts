/* Markdown as the wire format for a page's body, in both directions.

   The app edits a page as text and Notion stores it as blocks, so one of the two has to convert.
   Doing it here, symmetrically, is what makes the round trip lossless: every block type the app can
   render has a markdown spelling, and every markdown spelling maps back to exactly that block. Save
   a page, reopen it, and it comes back the way it was written.

   Block level only — no bold, italic or links. Those live inside a block's `rich_text` and would
   need the annotations carried through the whole read path, which is a separate change. Until then
   `**bold**` survives as literal asterisks rather than being silently eaten.

   The supported set is deliberately the same one `toDetailBlock` recognises and the views render.
   Anything Notion offers beyond it — toggles, callouts, tables, columns — has no spelling here and
   would be flattened to a paragraph, so pages carrying those should not be edited through the app. */

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

export interface MarkdownBlock {
    type: MarkdownBlockType
    text: string
    /** `to_do` only. */
    checked?: boolean
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

        if (DIVIDER.test(trimmed)) {
            blocks.push({ type: 'divider', text: '' })
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
    blocks: Array<{ type: string; text: string; checked?: boolean }>
): string {
    const lines: string[] = []

    for (const block of blocks) {
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
                lines.push(`1. ${block.text}`)
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
            case 'code': {
                lines.push(FENCE, ...block.text.split(NEWLINE), FENCE)
                break
            }
            default:
                lines.push(block.text)
        }
    }

    return lines.join('\n')
}
