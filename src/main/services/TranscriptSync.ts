import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { sessionFilePath } from './SessionTranscript'
import { getSessionStatuses, isSessionBusy, stopSession } from './ClaudeService'
import {
    attachChatTranscript,
    findChatTranscript,
    listChatTranscripts,
    type ChatTranscriptRef
} from './NotionService'

/* Keeps each chat's CLI transcript attached to its Notion row, so a chat opened on another machine
   has its history and can be resumed.

   The CLI only ever appends to a transcript, so the bigger copy is the newer one. The byte length
   rides in the attachment's file name, which lets either side decide who is behind without
   downloading anything. `.txt` because Notion's upload allowlist does not know `.jsonl`. */

const PULL_FRESH_MS = 30_000
const PUSH_DEBOUNCE_MS = 2_000
const BACKFILL_GAP_MS = 400

function fileName(sessionId: string, bytes: number): string {
    return `${sessionId}.${bytes}.txt`
}

function remoteBytes(ref: ChatTranscriptRef): number {
    const match = ref.name?.match(/\.(\d+)\.txt$/)
    return match ? Number(match[1]) : 0
}

function localBytes(sessionId: string): number {
    const path = sessionFilePath(sessionId)
    return existsSync(path) ? statSync(path).size : 0
}

const lastPulled = new Map<string, number>()
const pullsInFlight = new Map<string, Promise<void>>()

async function doPull(sessionId: string, beforeSend: boolean): Promise<void> {
    const running = (): boolean => sessionId in getSessionStatuses()
    /* A process mid-turn is appending to the file right now. When not sending, a running process is
       left alone too: it holds the conversation in memory and would write over a swapped file. */
    if (running() && (!beforeSend || isSessionBusy(sessionId))) return

    const ref = await findChatTranscript(sessionId)
    if (!ref?.url || remoteBytes(ref) <= localBytes(sessionId)) return

    const res = await fetch(ref.url)
    if (!res.ok) throw new Error(`transcript download failed: ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length <= localBytes(sessionId)) return

    /* Another device moved the chat on while this one's process sat idle with the old copy in
       memory. Replying from it would fork the conversation and overwrite the other device's turns,
       so it is ended and the send resumes from the newer file. */
    if (running()) {
        if (isSessionBusy(sessionId)) return
        stopSession(sessionId)
    }

    const path = sessionFilePath(sessionId)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
    console.log(`[sync] pulled ${sessionId} (${bytes.length} bytes)`)
}

/** Brings the local transcript up to the cloud copy if that one is newer. Never throws: offline,
    the local file is simply what there is. `beforeSend` always checks, skipping the freshness
    window, since a reply built on a stale copy is the one thing sync must not allow. */
export async function pullTranscript(sessionId: string, beforeSend = false): Promise<void> {
    const inFlight = pullsInFlight.get(sessionId)
    if (inFlight && !beforeSend) return inFlight
    if (inFlight) await inFlight
    if (!beforeSend && Date.now() - (lastPulled.get(sessionId) ?? 0) < PULL_FRESH_MS) return

    const pull = doPull(sessionId, beforeSend)
        .then(() => {
            lastPulled.set(sessionId, Date.now())
        })
        .catch((error) => console.error(`[sync] pull ${sessionId} failed:`, error))
        .finally(() => pullsInFlight.delete(sessionId))
    pullsInFlight.set(sessionId, pull)
    return pull
}

const PUSH_RETRY_MS = 15_000
const PUSH_MAX_FAILURES = 5

const lastPushed = new Map<string, number>()
const pushFailures = new Map<string, number>()
const pushTimers = new Map<string, NodeJS.Timeout>()
const pushChains = new Map<string, Promise<void>>()

async function doPush(sessionId: string, known?: ChatTranscriptRef): Promise<void> {
    const size = localBytes(sessionId)
    if (size === 0 || lastPushed.get(sessionId) === size) return

    const ref = known ?? (await findChatTranscript(sessionId))
    /* No row yet (a brand-new chat whose row is still being written): the next turn catches up. */
    if (!ref) return
    if (remoteBytes(ref) >= size) {
        lastPushed.set(sessionId, remoteBytes(ref))
        return
    }

    const bytes = readFileSync(sessionFilePath(sessionId))
    await attachChatTranscript(ref.pageId, fileName(sessionId, bytes.length), bytes)
    lastPushed.set(sessionId, bytes.length)
    console.log(`[sync] pushed ${sessionId} (${bytes.length} bytes)`)
}

/** Queues an upload of the transcript. Serial per chat, so overlapping turns cannot race each other
    into attaching an older copy last. */
function enqueuePush(sessionId: string, known?: ChatTranscriptRef): Promise<void> {
    const next = (pushChains.get(sessionId) ?? Promise.resolve())
        .then(() => doPush(sessionId, known))
        .then(() => {
            pushFailures.delete(sessionId)
        })
        .catch((error) => {
            /* Left alone, a failed upload waits for the next turn, and the last turn of a
               conversation would never make it up at all. */
            const failures = (pushFailures.get(sessionId) ?? 0) + 1
            pushFailures.set(sessionId, failures)
            console.error(`[sync] push ${sessionId} failed (attempt ${failures}):`, error)
            if (failures < PUSH_MAX_FAILURES) schedulePush(sessionId, PUSH_RETRY_MS * failures)
        })
    pushChains.set(sessionId, next)
    return next
}

/** Uploads the transcript shortly after a turn, coalescing a burst of turns into one upload. */
export function schedulePush(sessionId: string, delay = PUSH_DEBOUNCE_MS): void {
    clearTimeout(pushTimers.get(sessionId))
    pushTimers.set(
        sessionId,
        setTimeout(() => {
            pushTimers.delete(sessionId)
            void enqueuePush(sessionId)
        }, delay)
    )
}

/** Uploads every local transcript the cloud is missing or behind on. Paced under Notion's
    three-requests-a-second limit, since each upload is three calls. */
export async function backfillTranscripts(): Promise<void> {
    try {
        for (const ref of await listChatTranscripts()) {
            if (localBytes(ref.sessionId) <= remoteBytes(ref)) continue
            await enqueuePush(ref.sessionId, ref)
            await new Promise((resolve) => setTimeout(resolve, BACKFILL_GAP_MS))
        }
    } catch (error) {
        console.error('[sync] backfill failed:', error)
    }
}
