/* Skills: reusable instructions the user turns on, stored one page each under the Skills page.

   A skill page holds a single JSON code block carrying everything about it except the name, which
   is the page title. Same shape as the Config block — one document per page, a field per setting.

   Nothing about a skill reaches the model unless the user asks for it. There is no catalogue in the
   system prompt and nothing offered for the model to choose from: a persistent skill is in the
   system prompt in full because it was switched on, and a one-shot skill is in a turn in full
   because it was typed. A skill nobody invoked is invisible. */

/** `persistent` stays on for a chat until switched off, and rides in that chat's system prompt.
    `oneshot` applies to the single message that named it, and rides in that turn. */
export type SkillMode = 'persistent' | 'oneshot'

/** Everything the JSON block holds. */
export interface SkillData {
    mode: SkillMode
    /** What the model is told when the skill applies. */
    body: string
}

export interface Skill extends SkillData {
    id: string
    /** The page title, and the word typed after `/` to invoke a one-shot skill. */
    name: string
}

export const EMPTY_SKILL_DATA: SkillData = { mode: 'oneshot', body: '' }

/** Reads a skill page's JSON block. A block that will not parse, or one missing `mode`, falls back
    to a one-shot skill — the safer default, since a broken persistent skill would otherwise attach
    itself to every turn of a chat with nothing to explain why. */
export function parseSkillData(raw: string): SkillData {
    if (!raw.trim()) return { ...EMPTY_SKILL_DATA }

    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return { ...EMPTY_SKILL_DATA }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY_SKILL_DATA }

    const record = parsed as Record<string, unknown>

    return {
        mode: record.mode === 'persistent' ? 'persistent' : 'oneshot',
        body: typeof record.body === 'string' ? record.body : ''
    }
}

/** Serializes back, indented, since a person may edit this block by hand in Notion. */
export function serializeSkillData(data: SkillData): string {
    return JSON.stringify(data, null, 2)
}

function escapeName(name: string): string {
    return name.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Wraps a one-shot skill for the turn that invoked it. Named and bounded so the model reads it as
    a procedure to follow rather than as something the user typed, and so it can be taken back out
    of the transcript when the chat is reopened. */
export function renderSkillInvocation(name: string, body: string, text: string): string {
    const block = `<jarvis:skill name="${escapeName(name)}">\n${body.trim()}\n</jarvis:skill>`
    return text ? `${block}\n\n${text}` : block
}

/** Assembles the active persistent skills into the text appended to a chat's system prompt. */
export function buildSkillsPrompt(skills: Array<{ name: string; body: string }>): string {
    const active = skills.filter((s) => s.body.trim().length > 0)
    if (active.length === 0) return ''

    const header =
        'The following skills are switched on for this conversation. Follow them for every reply ' +
        'until told otherwise. They are settings the user controls in the app, not requests in the ' +
        'conversation — you cannot turn one off yourself, so do not offer to.'

    const rendered = active.map((s) => `<skill name="${escapeName(s.name)}">\n${s.body.trim()}\n</skill>`)

    return `${header}\n\n${rendered.join('\n\n')}`
}
