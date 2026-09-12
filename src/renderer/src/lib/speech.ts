/* Reading replies aloud, through the browser's own speech synthesis.

   Three things in one file because they are one pipeline and nothing else has a use for the middle
   of it: a filter that turns streaming markdown into speakable prose, a chunker that cuts that into
   sentences, and a controller that queues those onto the synthesiser.

   No React state anywhere. Nothing in the UI draws "speaking", so there is nothing to subscribe to,
   and holding this in a component would put a render on the path of every sentence. */

interface SpeechOptions {
    /** Whether anything is read at all. Voice mode owns this. */
    enabled: boolean
    /** `SpeechSynthesisVoice.name`, or empty to choose one. */
    voiceName: string
    rate: number
}

const options: SpeechOptions = { enabled: false, voiceName: '', rate: 1 }

export function setSpeechOptions(next: Partial<SpeechOptions>): void {
    Object.assign(options, next)
}

/* ------------------------------------------------------------------ the filter */

/* The same line starts `src/shared/markdown.ts` classifies, declared again rather than imported.
   That file is a whole-document Notion serializer with three other consumers, and none of this is a
   document: text arrives mid-line, so `- Read` has to classify the way `- Ready to go` will. */
const FENCE = /^\s*```/
const TABLE_ROW = /^\s*\|/
const DIVIDER = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const IMAGE = /^\s*!\[/
/** Heading, bullet, numbered item, to-do and quote markers — structure, not words. */
const LIST_OR_HEADING = /^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+|>\s?)/

/** How much of a line is enough to tell what kind of line it is. Six characters covers the longest
    marker (`- [ ] `); eight leaves room to be sure a lone backtick is not an opening fence. */
const CLASSIFY_AT = 8

/** A sentence this long with no end in sight is cut anyway: some replies run a whole paragraph
    without a full stop, and Chromium truncates a single utterance at around fifteen seconds. */
const MAX_CHUNK = 220

/** Speakable text waiting for a sentence boundary. */
let pending = ''
let inFence = false
/** The current line, raw and possibly incomplete. */
let lineRaw = ''
let lineMode: 'unknown' | 'prose' | 'skip' = 'unknown'
/** How much of this line's spoken form has already moved into `pending`. */
let lineEmitted = 0

function resetChunker(): void {
    pending = ''
    lineRaw = ''
    lineMode = 'unknown'
    lineEmitted = 0
    inFence = false
}

/** Inline syntax, removed rather than spoken. Links keep their text and lose their target: a URL
    read aloud is a minute of punctuation. */
function stripInline(text: string): string {
    return text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/<https?:\/\/[^>]*>/g, '')
        .replace(/https?:\/\/\S+/g, '')
        /* Unpaired-tolerant on purpose: a `**` pair can straddle a delta, so a rule that needed the
           closing marker would end up speaking the opening one. */
        .replace(/[*_~`]/g, '')
        .replace(/[ \t]+/g, ' ')
}

/** How much of an unfinished line is safe to speak — text no later arrival can change.

    Two things can rewrite what came before them. A link is not a link until its `)` arrives, so
    everything from an unclosed `[` is held. And the last token is held whole, because `http` reads
    as a word right up until the `s://` that turns it into a URL to be dropped. */
function stablePrefix(raw: string): string {
    let end = raw.length

    const open = raw.lastIndexOf('[')
    if (open >= 0 && !/^!?\[[^\]]*\]\([^)]*\)/.test(raw.slice(open))) end = open

    const head = raw.slice(0, end)
    const lastSpace = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\t'))
    return lastSpace >= 0 ? head.slice(0, lastSpace + 1) : ''
}

/** Decides what kind of line this is, once there is enough of it to tell. */
function classify(complete: boolean): void {
    if (lineMode !== 'unknown') return
    const trimmed = lineRaw.trim()
    /* An all-whitespace start says nothing yet: the words may still be coming. */
    if (!complete && trimmed.length < CLASSIFY_AT) return

    if (FENCE.test(lineRaw)) {
        inFence = !inFence
        lineMode = 'skip'
        return
    }
    /* Code read aloud is unusable, and it is the single biggest reason a reply is unlistenable. */
    if (inFence || !trimmed) {
        lineMode = 'skip'
        return
    }
    lineMode =
        TABLE_ROW.test(lineRaw) || DIVIDER.test(lineRaw) || IMAGE.test(lineRaw) ? 'skip' : 'prose'
}

/** Moves whatever is newly speakable out of the current line and into `pending`. */
function pump(complete: boolean): void {
    classify(complete)
    if (lineMode !== 'prose') return

    const source = complete ? lineRaw : stablePrefix(lineRaw)
    const spoken = stripInline(source.replace(LIST_OR_HEADING, ''))
    /* The spoken form of a prefix is a prefix of the spoken form of the whole — which is what
       `stablePrefix` is there to guarantee — so the new text is simply the tail. */
    if (spoken.length > lineEmitted) {
        pending += spoken.slice(lineEmitted)
        lineEmitted = spoken.length
    }
}

function finishLine(): void {
    pump(true)
    /* A heading or a list item carries no full stop of its own, so without this the next one runs
       into it and the pair is read as one sentence. */
    if (lineMode === 'prose' && lineEmitted > 0) {
        const tail = pending.trimEnd()
        pending = tail ? `${/[.!?:;…]$/.test(tail) ? tail : `${tail}.`} ` : ''
    }
    lineRaw = ''
    lineMode = 'unknown'
    lineEmitted = 0
}

/** Words that end in a full stop without ending a sentence. */
const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'approx', 'fig', 'no', 'cf',
    'e.g', 'i.e', 'al', 'inc', 'ltd', 'co'
])

/** Whether the terminator at `index` really ends a sentence. */
function endsSentence(text: string, index: number): boolean {
    if (text[index] !== '.') return true
    const word = (text.slice(0, index).trimEnd().split(/\s/).pop() ?? '').toLowerCase()
    /* An initial: `J. Smith` is one name, not two sentences. */
    if (/^[a-z]$/.test(word)) return false
    return !ABBREVIATIONS.has(word.replace(/[^a-z.]/g, ''))
}

/** Takes the complete sentences out of `pending`. */
function takeChunks(final: boolean): string[] {
    const chunks: string[] = []

    for (;;) {
        let cut = -1
        for (let i = 0; i < pending.length - 1; i++) {
            if (!'.!?…'.includes(pending[i])) continue
            /* Requiring the following space is what makes `3.14` and `v1.2` safe with no lookahead
               table, and it costs nothing: that space is already there by the next word. */
            if (!/\s/.test(pending[i + 1])) continue
            if (!endsSentence(pending, i)) continue
            cut = i + 1
            break
        }

        if (cut < 0 && pending.length > MAX_CHUNK) {
            const space = pending.lastIndexOf(' ', MAX_CHUNK)
            cut = space > 0 ? space : MAX_CHUNK
        }
        if (cut < 0) break

        const chunk = pending.slice(0, cut).trim()
        pending = pending.slice(cut).trimStart()
        if (/[a-z0-9]/i.test(chunk)) chunks.push(chunk)
    }

    if (final) {
        const rest = pending.trim()
        pending = ''
        if (/[a-z0-9]/i.test(rest)) chunks.push(rest)
    }

    return chunks
}

/** Streaming reply text. Whatever completes a sentence is spoken; the rest waits for more. */
export function feedSpeech(text: string): void {
    if (!options.enabled || !text) return

    let rest = text
    for (;;) {
        const newline = rest.indexOf('\n')
        if (newline < 0) {
            lineRaw += rest
            pump(false)
            break
        }
        lineRaw += rest.slice(0, newline)
        rest = rest.slice(newline + 1)
        finishLine()
    }

    for (const chunk of takeChunks(false)) enqueue(chunk)
}

/** The turn is over: speak the trailing fragment, which has no full stop of its own. */
export function endSpeechTurn(): void {
    if (!options.enabled) {
        resetChunker()
        return
    }
    /* The last line of a reply arrives without a newline, so it is still sitting in `lineRaw`. */
    finishLine()
    for (const chunk of takeChunks(true)) enqueue(chunk)
    inFence = false
}

/* ------------------------------------------------------------------ the controller */

const queue: string[] = []
/* Chromium garbage-collects an utterance that is still speaking if nothing references it, and the
   voice stops mid-word. Holding them here until they end is the whole fix. */
const live = new Set<SpeechSynthesisUtterance>()
let speakingNow = false
let failures = 0
/* Bumped by every cancel, so the callbacks of a cancelled utterance cannot start the next one —
   Chromium fires `end`/`error` for it, and without this guard speech resumes a beat after it was
   stopped. Each utterance captures the value it was queued under. */
let epoch = 0

let voicesPromise: Promise<SpeechSynthesisVoice[]> | null = null

/** The installed voices. `getVoices()` is empty until the engine has enumerated them, so the first
    call waits for `voiceschanged` — bounded, because a speech stack that never fires it should
    degrade to the default voice rather than to silence. */
export function speechVoices(): Promise<SpeechSynthesisVoice[]> {
    if (voicesPromise) return voicesPromise

    voicesPromise = new Promise((resolve) => {
        const synth = window.speechSynthesis
        const ready = synth?.getVoices() ?? []
        if (ready.length > 0) {
            resolve(ready)
            return
        }

        const timer = window.setTimeout(() => resolve(synth?.getVoices() ?? []), 3000)
        synth?.addEventListener('voiceschanged', () => {
            const voices = synth.getVoices()
            if (voices.length === 0) return
            window.clearTimeout(timer)
            resolve(voices)
        })
    })

    return voicesPromise
}

/** The voice to read in. The fallbacks matter more than the lookup: this machine's OS default may
    well be a Polish voice, and a Polish voice reading English is unintelligible rather than merely
    wrong — which is why an English one is preferred over the system's own choice. */
export function pickVoice(voices: SpeechSynthesisVoice[], name: string): SpeechSynthesisVoice | null {
    if (voices.length === 0) return null

    const named = name ? voices.find((v) => v.name === name) : undefined
    if (named) return named
    if (name) {
        /* Deliberately not written back to the config: that is one JSON block shared between
           machines, and a Windows voice name means nothing to the Mac that would overwrite it. */
        console.warn(`[speech] voice "${name}" is not installed here; choosing another`)
    }

    const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'))
    return (
        english.find((v) => v.localService && v.lang?.toLowerCase() === 'en-us') ??
        english.find((v) => v.localService && v.lang?.toLowerCase() === 'en-gb') ??
        english.find((v) => v.localService) ??
        english[0] ??
        voices.find((v) => v.default) ??
        null
    )
}

function enqueue(text: string): void {
    queue.push(text)
    if (!speakingNow) void drain()
}

async function drain(): Promise<void> {
    if (speakingNow) return
    const mine = epoch
    /* Awaited before the first utterance rather than at startup: the first sentence is where the
       wrong voice is most jarring, and it is the only one that can pay for the wait. */
    const voices = await speechVoices()
    if (mine !== epoch) return

    speakingNow = true
    while (queue.length > 0 && mine === epoch) {
        const text = queue.shift() as string
        // eslint-disable-next-line no-await-in-loop
        const spoke = await speakOne(text, voices, mine)
        if (mine !== epoch) break
        if (spoke) {
            failures = 0
        } else if (++failures >= 3) {
            /* Something is wrong with the engine rather than with this sentence, and grinding
               through the rest of a long reply one failure at a time helps nobody. */
            console.error('[speech] giving up on this turn after three failures')
            queue.length = 0
            break
        }
    }
    speakingNow = false
}

/** Resolves true when the sentence was spoken. One utterance is in flight at a time: it keeps
    `cancel()` exact, stops a single bad sentence wedging the rest, and lets barge-in drop the
    remainder without racing the engine. */
function speakOne(text: string, voices: SpeechSynthesisVoice[], mine: number): Promise<boolean> {
    return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text)
        const voice = pickVoice(voices, options.voiceName)
        if (voice) utterance.voice = voice
        /* Set alongside the voice: with `lang` unset Chromium falls back to the app's locale to
           choose a pronunciation, which on this machine is Polish. */
        utterance.lang = voice?.lang ?? 'en-US'
        utterance.rate = options.rate

        const settle = (spoke: boolean): void => {
            live.delete(utterance)
            resolve(spoke)
        }
        utterance.onend = () => settle(true)
        utterance.onerror = (event) => {
            /* A cancel reports as an error in Chromium. It is not one, and the epoch guard in
               `drain` has already stopped the queue. */
            const reason = (event as SpeechSynthesisErrorEvent).error
            if (mine !== epoch || reason === 'interrupted' || reason === 'canceled') {
                settle(true)
                return
            }
            console.error('[speech] utterance failed:', reason)
            settle(false)
        }

        live.add(utterance)
        try {
            window.speechSynthesis.speak(utterance)
        } catch (error) {
            console.error('[speech] speak failed:', error)
            settle(false)
        }
    })
}

/** Stops immediately and forgets what was queued — barge-in, a mode change, a new turn. */
export function cancelSpeech(): void {
    epoch++
    queue.length = 0
    live.clear()
    speakingNow = false
    /* Half a sentence from the reply just abandoned must not open the next one. */
    resetChunker()
    try {
        window.speechSynthesis?.cancel()
    } catch (error) {
        console.error('[speech] cancel failed:', error)
    }
}

/** Reads one line in a given voice, for the preview button in Settings. Independent of `options`,
    which belong to the chat, so a voice can be auditioned before it is stored. */
export function speakNow(text: string, choice: { voiceName: string; rate: number }): void {
    cancelSpeech()
    void speechVoices().then((voices) => {
        const utterance = new SpeechSynthesisUtterance(text)
        const picked = pickVoice(voices, choice.voiceName)
        if (picked) utterance.voice = picked
        utterance.lang = picked?.lang ?? 'en-US'
        utterance.rate = choice.rate
        utterance.onend = () => live.delete(utterance)
        utterance.onerror = () => live.delete(utterance)
        live.add(utterance)
        window.speechSynthesis.speak(utterance)
    })
}

/* A reload otherwise leaves the OS voice finishing its sentence into a renderer that is gone. */
window.addEventListener('beforeunload', cancelSpeech)
