/* A person's affiliations, as they sit in the People database's one rich_text column.

   The column stays a single string so the Notion schema is untouched and a person read outside the
   app still says something legible; the app treats it as a comma-separated list. That makes the
   comma a separator rather than a character, which is why the settings list refuses to accept one
   in a name — see `isValidAffiliation`. */

/** Splits the column into the names it holds, trimmed, blanks and repeats dropped. */
export function parseAffiliations(raw: string): string[] {
    const seen = new Set<string>()
    const out: string[] = []

    for (const part of raw.split(',')) {
        const name = part.trim()
        if (!name || seen.has(name.toLowerCase())) continue
        seen.add(name.toLowerCase())
        out.push(name)
    }

    return out
}

/** Back to the one string the column holds. */
export function serializeAffiliations(names: string[]): string {
    return names.join(', ')
}

/** What the settings list will store: something non-empty that survives the round trip above. */
export function isValidAffiliation(name: string): boolean {
    const trimmed = name.trim()
    return trimmed.length > 0 && !trimmed.includes(',')
}
