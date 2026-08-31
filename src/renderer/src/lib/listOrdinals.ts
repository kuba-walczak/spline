/* What number each item of a numbered list carries.

   Notion stores a numbered list as a run of `numbered_list_item` blocks and no numbers at all — the
   position in the run is the number, which is why editing one in Notion renumbers the rest for free.
   A reader has to count them back, and anything that is not another item ends the run: a paragraph
   between two lists in Notion starts the second one at 1 again, and so does this. */

export function listOrdinals(blocks: Array<{ id: string; type: string }>): Map<string, number> {
    const ordinals = new Map<string, number>()
    let n = 0

    for (const block of blocks) {
        if (block.type !== 'numbered_list_item') {
            n = 0
            continue
        }
        n += 1
        ordinals.set(block.id, n)
    }

    return ordinals
}
