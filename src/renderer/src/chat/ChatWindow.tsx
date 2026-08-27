import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { Composer } from '@/components/ui/composer'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import { SettingsModal } from './SettingsModal'
import { ProjectContextModal } from './ProjectContextModal'
import ProjectDetailView from './ProjectDetailView'
import { Icon } from '@/components/ui/icon'
import { buildSystemPrompt } from '@shared/injection'
import type { SessionStatus } from './Sidebar'

/* Implementation of `Chat Window.dc.html` from the Claude app design system.

   Each chat is backed by its own CLI session, identified by a uuid the app mints up front and
   stores on the chat's Notion row. The CLI writes that session's transcript to disk, and the app
   reads it back to render history — so continuing a chat is `--resume`, not replaying context
   into a prompt. Notion holds the index (title, project, session id), never the messages. */

type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; query: string }

interface Message {
  id: number
  role: 'user' | 'assistant'
  parts: MessagePart[]
}

function textPart(text: string): MessagePart[] {
  return text ? [{ kind: 'text', text }] : []
}

/** One part of a message as the session transcript stores it. */
interface TranscriptPart {
  kind: 'text' | 'tool'
  text: string
  label?: string
}

function textOf(parts: MessagePart[]): string {
  return parts
    .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
    .map((p) => p.text)
    .join('')
}

/** Maps the transcript's part shapes onto the ones the bubbles render. What a project contributes
    never appears here — it lives in the system prompt, and is shown from the composer chip. */
function transcriptToParts(parts: TranscriptPart[]): MessagePart[] {
  return parts.map((p) => {
    if (p.kind === 'tool') return { kind: 'tool' as const, name: p.label || 'tool', query: p.text }
    return { kind: 'text' as const, text: p.text }
  })
}

interface Conversation {
  id: number
  title: string
  messages: Message[]
  /** The CLI session backing this chat — the id passed to `--resume`. */
  sessionId: string
  /** Per-chat model and effort, stored on the chat's Notion row and restored when it reopens. */
  model: string
  effort: string
  sourceId?: string
  loaded?: boolean
  /** Titles of every project ever injected into this conversation — drives the sidebar tint and locks
      that project's attach option so it can't be added again. */
  referencedProjectTitles?: string[]
  /** Assembled context for every attached project, as last sent to the CLI's system prompt.
      `undefined` means it has not been assembled yet this run — a reopened chat starts that way and
      builds it on its next send. Deliberately not persisted: it is a cache of what Notion holds, and
      rebuilding it is how an edited project reaches an existing chat. */
  systemPrompt?: string
  /** The projects' version stamps at the moment `systemPrompt` was assembled, keyed by project id.
      Compared against fresh stamps on each send to notice a project edited since. */
  contextVersions?: Record<string, string>
}

interface Project {
  id: string
  title: string
  color: string | null
}

const CARET = '▍'
const UNTITLED = 'New chat'

const MODELS = [
  { id: 'opus', name: 'Opus 5', description: 'Most capable model for complex challenges' },
  { id: 'sonnet', name: 'Sonnet 5', description: 'Most efficient for everyday tasks' },
  { id: 'haiku', name: 'Haiku 4.5', description: 'Fastest for daily tasks' }
]

const EFFORTS = [
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'extra', name: 'Extra' },
  { id: 'max', name: 'Max' }
]
const DEFAULT_EFFORT_ID = 'high'
const DEFAULT_MODEL_ID = 'opus'

interface ContentBlock {
  type: string
  name?: string
  input?: unknown
}

/** Reduces a tool's input object down to just its values — no field names or braces. */
function queryOf(input: unknown): string {
  if (input === null || input === undefined) return ''
  if (typeof input !== 'object') return String(input)
  return Object.values(input as Record<string, unknown>)
    .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)))
    .join(' ')
}

/** Only surfaces tool calls and the final answer — drops system/init/partial/tool-result noise. */
function formatEvent(event: Record<string, unknown>): MessagePart[] {
  if (event.type === 'assistant') {
    const content = (event.message as { content?: ContentBlock[] } | undefined)?.content ?? []
    return content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({ kind: 'tool' as const, name: block.name ?? 'tool', query: queryOf(block.input) }))
  }

  if (event.type === 'result') {
    const result = event as { is_error?: boolean; result?: string }
    return result.is_error ? [] : textPart(result.result ?? '')
  }

  return []
}

function titleFrom(text: string): string {
  const line = text.split('\n')[0].trim()
  return line.length > 48 ? `${line.slice(0, 48).trimEnd()}…` : line || UNTITLED
}

export interface ChatWindowProps {
  /** Layout — show the app sidebar next to the conversation. */
  showSidebar?: boolean
  /** Messages — user bubble treatment. */
  userBubble?: 'Filled' | 'Outlined'
  /** Resolve the assistant reply for a sent message, on the given chat's CLI session. */
  onSend?: (
    sessionId: string,
    text: string,
    model: string,
    effort: string,
    systemPrompt: string
  ) => Promise<string>
}


export default function ChatWindow({
  showSidebar = true,
  userBubble = 'Filled',
  onSend
}: ChatWindowProps): ReactElement {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [notionChats, setNotionChats] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [route, setRoute] = useState('home')
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [attachedProjects, setAttachedProjects] = useState<Project[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(308)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** Project whose injected context is open in the modal, by id. */
  const [contextProjectId, setContextProjectId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [streamingId, setStreamingId] = useState<number | null>(null)
  /* Model and effort belong to a chat, not the app. These hold the choice for whichever chat is
     open, and seed the next new one so picking a model carries forward the way a user expects. */
  /** Process lifecycle per session id, driving each sidebar row's dot. Absent means idle. */
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({})
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID)
  const [effortId, setEffortId] = useState(DEFAULT_EFFORT_ID)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastMessageRef = useRef<HTMLDivElement | null>(null)
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const [fadeEdges, setFadeEdges] = useState({ top: false, bottom: false })

  const SIDEBAR_MIN = 200
  const SIDEBAR_MAX = 480
  const SIDEBAR_SNAP_CLOSE = 220

  function startSidebarResize(e: ReactMouseEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth

    function onMove(ev: MouseEvent): void {
      const next = startWidth + (ev.clientX - startX)
      if (next < SIDEBAR_SNAP_CLOSE) {
        setSidebarCollapsed(true)
        return
      }
      setSidebarCollapsed(false)
      setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next)))
    }

    function onUp(): void {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function updateFadeEdges(): void {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop > 4
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 4
    setFadeEdges((prev) => (prev.top === top && prev.bottom === bottom ? prev : { top, bottom }))
  }

  /** Only fades the edge that actually has more content scrolled past it — a short
      conversation stays fully opaque instead of washing out under a fixed-height mask. */
  function fadeMask(edges: { top: boolean; bottom: boolean }): string | undefined {
    if (!edges.top && !edges.bottom) return undefined
    const stops = [
      edges.top ? 'transparent, black 128px' : 'black 0%',
      edges.bottom ? 'black calc(100% - 128px), transparent' : 'black 100%'
    ]
    return `linear-gradient(to bottom, ${stops.join(', ')})`
  }
  const nextConversationId = useRef(1)
  const nextMessageId = useRef(1)
  const nextNotionId = useRef(-1)
  const notionIdBySourceId = useRef(new Map<string, number>())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamTarget = useRef<{ conversationId: number; botId: number; sessionId: string } | null>(null)
  const streamParts = useRef<MessagePart[]>([])
  const conversationsRef = useRef<Conversation[]>([])
  const notionChatsRef = useRef<Conversation[]>([])
  const pendingPageId = useRef(new Map<number, Promise<string>>())
  /** Session id per conversation, readable the instant a chat is created — `send` needs it before
      React has committed the new conversation to state. */
  const sessionIdByConversation = useRef(new Map<number, string>())

  function refreshChatLog(): void {
    window.api
      .getChatLog()
      .then((entries) => {
        setNotionChats((prev) => {
          const bySourceId = new Map(prev.map((c) => [c.sourceId, c]))
          const localSourceIds = new Set(conversationsRef.current.map((c) => c.sourceId).filter(Boolean))
          return entries
            .filter((entry) => Boolean(entry.sessionId) && !localSourceIds.has(entry.id))
            .map((entry) => {
              const existing = bySourceId.get(entry.id)
              let id = notionIdBySourceId.current.get(entry.id)
              if (id === undefined) {
                id = nextNotionId.current--
                notionIdBySourceId.current.set(entry.id, id)
              }
              if (entry.sessionId) sessionIdByConversation.current.set(id, entry.sessionId)
              return {
                id,
                title: entry.name,
                messages: existing?.messages ?? [],
                loaded: existing?.loaded,
                sessionId: entry.sessionId ?? '',
                model: entry.model ?? DEFAULT_MODEL_ID,
                effort: entry.effort ?? DEFAULT_EFFORT_ID,
                sourceId: entry.id,
                /* Replaces rather than merges: the row is the authoritative set, and a project
                   detached from the chat has to stay detached. */
                referencedProjectTitles: entry.projects,
                systemPrompt: existing?.systemPrompt,
                contextVersions: existing?.contextVersions
              }
            })
        })
      })
      .catch((error) => console.error('[chat] getChatLog failed:', error))
  }

  function refreshProjects(): void {
    window.api
      .getProjects()
      .then((entries) => {
        setProjects(
          entries.map((entry) => ({ id: entry.id, title: entry.title || 'Untitled', color: entry.color }))
        )
      })
      .catch((error) => console.error('[projects] getProjects failed:', error))
  }

  useEffect(() => {
    refreshChatLog()
    refreshProjects()
  }, [])

  /* Model and effort are spawn arguments, so changing either replaces the chat's process straight
     away — it comes back on `--resume`, so the conversation is untouched and the sidebar dot shows
     the restart. A chat with no process running stays idle; its next send uses the new flags. */
  function applyChatSetting(model: string, effort: string): void {
    if (activeId === null) return

    patch(activeId, (c) => ({ ...c, model, effort }))

    const sessionId = sessionIdByConversation.current.get(activeId)
    if (sessionId) {
      void window.api
        .restartClaudeSession(sessionId, model, effort)
        .catch((error) => console.error('[claude] restartClaudeSession failed:', error))
    }

    const conversationId = activeId
    void ensureSourceId(conversationId)
      .then((sourceId) => {
        if (!sourceId) return undefined
        return Promise.all([
          window.api.setChatModel(sourceId, model),
          window.api.setChatEffort(sourceId, effort)
        ])
      })
      .catch((error) => console.error('[chat] saving model/effort failed:', error))
  }

  function selectModel(id: string): void {
    setModelId(id)
    applyChatSetting(id, effortId)
  }

  function selectEffort(id: string): void {
    setEffortId(id)
    applyChatSetting(modelId, id)
  }

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  useEffect(() => {
    notionChatsRef.current = notionChats
  }, [notionChats])

  const allConversations = notionChats.concat(conversations)

  /** Resolves stored project titles back to the projects themselves. Titles are what a chat's Notion
      row records, so a project renamed in Notion drops out here until the chat is re-attached. */
  function projectsForTitles(titles: string[]): Project[] {
    const byTitle = new Map(projects.map((p) => [p.title, p]))
    return titles.map((t) => byTitle.get(t)).filter((p): p is Project => Boolean(p))
  }

  function colorsFor(titles: string[] | undefined): string[] {
    if (!titles || titles.length === 0) return []
    const byTitle = new Map(projects.map((p) => [p.title, p.color]))
    return Array.from(new Set(titles.map((t) => byTitle.get(t)).filter((c): c is string => Boolean(c))))
  }

  const active = allConversations.find((c) => c.id === activeId) ?? null
  const messages = active ? active.messages : []
  const contextProject = contextProjectId ? (projects.find((p) => p.id === contextProjectId) ?? null) : null

  /** Keeps the newest message vertically centered instead of pinned to the bottom edge, near the
      composer — a spacer after the last message pads the scroll area so centering it (via scrollTop)
      still lands on the true bottom once the message grows past the spacer. */
  useLayoutEffect(() => {
    const el = scrollRef.current
    const lastEl = lastMessageRef.current
    const spacerEl = spacerRef.current
    if (!el) return
    if (spacerEl) {
      const lastHeight = lastEl?.offsetHeight ?? 0
      const spacer = Math.max(0, Math.round((el.clientHeight - lastHeight) / 2))
      spacerEl.style.height = `${spacer}px`
    }
    el.scrollTop = el.scrollHeight
    updateFadeEdges()
  }, [messages, activeId, streamingId])

  useEffect(() => () => clearTimer(), [])

  useEffect(() => {
    /* Seeded from the main process because the window can open after sessions are already up —
       otherwise a live chat would sit on a black dot until its next transition. */
    window.api
      .getSessionStatuses()
      .then(setSessionStatuses)
      .catch((error) => console.error('[claude] getSessionStatuses failed:', error))

    return window.api.onClaudeStatus(({ sessionId, status }) => {
      setSessionStatuses((prev) => ({ ...prev, [sessionId]: status }))
    })
  }, [])

  useEffect(() => {
    if (!window.api.onClaudeEvent) return
    return window.api.onClaudeEvent(({ sessionId, event }) => {
      const target = streamTarget.current
      if (!target || target.sessionId !== sessionId) return
      const parts = formatEvent(event)
      if (parts.length > 0) appendParts(target, parts)
    })
  }, [])

  function mergeParts(parts: MessagePart[], newParts: MessagePart[]): MessagePart[] {
    const merged = parts.slice()
    for (const part of newParts) {
      const lastPart = merged[merged.length - 1]
      if (part.kind === 'text' && lastPart?.kind === 'text') {
        merged[merged.length - 1] = { kind: 'text', text: lastPart.text + part.text }
      } else {
        merged.push(part)
      }
    }
    return merged
  }

  function appendParts(
    target: { conversationId: number; botId: number; sessionId: string },
    newParts: MessagePart[]
  ): void {
    streamParts.current = mergeParts(streamParts.current, newParts)
    patch(target.conversationId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === target.botId ? { ...m, parts: mergeParts(m.parts, newParts) } : m))
    }))
  }

  function clearTimer(): void {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  function patch(id: number, fn: (c: Conversation) => Conversation): void {
    setConversations((prev) => (prev.some((c) => c.id === id) ? prev.map((c) => (c.id === id ? fn(c) : c)) : prev))
    setNotionChats((prev) => (prev.some((c) => c.id === id) ? prev.map((c) => (c.id === id ? fn(c) : c)) : prev))
  }

  /** Rebuilds a chat's messages from its CLI session transcript. Comes back empty once the CLI has
      cleaned the session up (`cleanupPeriodDays`), which is the point at which the chat is gone. */
  function loadTranscript(chat: Conversation): void {
    if (!chat.sessionId || chat.loaded) return

    patch(chat.id, (c) => ({ ...c, loaded: true }))
    window.api
      .readSessionTranscript(chat.sessionId)
      .then((rows) => {
        const loadedMessages = rows.map((row) => ({
          id: nextMessageId.current++,
          role: row.role,
          parts: transcriptToParts(row.parts)
        }))
        patch(chat.id, (c) => ({ ...c, messages: loadedMessages }))
      })
      .catch((error) => {
        console.error('[chat] readSessionTranscript failed:', error)
        patch(chat.id, (c) => ({ ...c, loaded: false }))
      })
  }

  function createConversation(): number {
    const id = nextConversationId.current++
    /* Minted here rather than scraped off the CLI's `init` event, so the chat has an addressable
       session from the moment it exists and the Notion row is never written without one. */
    const sessionId = crypto.randomUUID()
    sessionIdByConversation.current.set(id, sessionId)
    setConversations((prev) =>
      prev.concat({ id, title: UNTITLED, messages: [], sessionId, model: modelId, effort: effortId, loaded: true })
    )
    setActiveId(id)
    setDraft('')
    setRoute('home')

    const pagePromise = window.api
      .createChatPage(UNTITLED, sessionId, modelId, effortId)
      .then((pageId) => {
        patch(id, (c) => ({ ...c, sourceId: pageId, loaded: true }))
        return pageId
      })
      .catch((error) => {
        console.error('[chat] createChatPage failed:', error)
        throw error
      })
    pendingPageId.current.set(id, pagePromise)

    return id
  }

  /* The user-facing "new chat" action. Separate from `createConversation` because `send` calls that
     too, to mint a conversation for a message being sent right now — clearing the chips there would
     be discarding the very attachments that send is about to use. */
  function startNewChat(): void {
    setAttachedProjects([])
    createConversation()
  }

  async function ensureSourceId(conversationId: number): Promise<string | undefined> {
    const conv =
      conversationsRef.current.find((c) => c.id === conversationId) ??
      notionChatsRef.current.find((c) => c.id === conversationId)
    if (conv?.sourceId) return conv.sourceId

    const pending = pendingPageId.current.get(conversationId)
    if (!pending) return undefined

    try {
      return await pending
    } catch {
      return undefined
    }
  }

  function openProject(id: string): void {
    setActiveProjectId(id)
    setRoute('project')
  }

  /** Navigates to a chat's transcript given its Notion page id — the id shape a project's context box lists chats by. */
  function openChatBySourceId(sourceId: string): void {
    const chat = allConversations.find((c) => c.sourceId === sourceId)
    if (chat) selectConversation(chat.id)
  }

  function newProject(): void {
    if (creatingProject) return
    setCreatingProject(true)
    window.api
      .createProject('Untitled project')
      .then((id) => {
        refreshProjects()
        openProject(id)
      })
      .catch((error) => console.error('[projects] createProject failed:', error))
      .finally(() => setCreatingProject(false))
  }

  interface AssembledContext {
    systemPrompt: string
    /** Stamps the prompt was built from — what a later send compares against to spot an edit. */
    versions: Record<string, string>
  }

  /** Reads the current version stamp of every attached project. Cheap next to assembling the
      context: it skips the per-context-page fetches that make that expensive. */
  async function readVersions(attached: Project[]): Promise<Record<string, string>> {
    const entries = await Promise.all(
      attached.map(async (p) => [p.id, await window.api.getProjectVersion(p.id)] as const)
    )
    return Object.fromEntries(entries)
  }

  /** Assembles what the CLI's system prompt gets appended for a set of projects. Empty for an empty
      set, which spawns the process with no extra flags at all.

      The stamps are read after the context, not before: a project edited mid-assembly then leaves a
      stamp newer than what was actually fetched, and the next send reassembles. Reading them first
      would record the edit as already included and never pick it up. */
  async function assembleSystemPrompt(attached: Project[]): Promise<AssembledContext> {
    if (attached.length === 0) return { systemPrompt: '', versions: {} }
    try {
      const contexts = await Promise.all(
        attached.map(async (p) => ({ title: p.title, text: (await window.api.getProjectContext(p.id)).trim() }))
      )
      const versions = await readVersions(attached)
      return { systemPrompt: buildSystemPrompt(contexts.map((c) => ({ label: c.title, text: c.text }))), versions }
    } catch (error) {
      console.error('[chat] project context assembly failed:', error)
      return { systemPrompt: '', versions: {} }
    }
  }

  /** Applies a change to the attached set: rebuilds the context, records it on the chat's Notion row,
      and respawns the CLI so the new system prompt takes effect now rather than on the next send.
      Attaching and detaching both come through here — the system prompt is replaced wholesale, so a
      removal genuinely drops that project's context rather than leaving it behind in the history. */
  function applyAttachment(next: Project[]): void {
    setAttachedProjects(next)

    const conversationId = activeId
    /* Nothing to persist or respawn for a chat that does not exist yet — `send` assembles from the
       staged set when it creates one. */
    if (conversationId === null) return

    const titles = next.map((p) => p.title)
    const sessionId = sessionIdByConversation.current.get(conversationId)

    void (async () => {
      const { systemPrompt, versions } = await assembleSystemPrompt(next)
      patch(conversationId, (c) => ({
        ...c,
        referencedProjectTitles: titles,
        systemPrompt,
        contextVersions: versions
      }))

      const conv = conversationsRef.current.find((c) => c.id === conversationId)
      if (sessionId) {
        await window.api.restartClaudeSession(
          sessionId,
          conv?.model ?? modelId,
          conv?.effort ?? effortId,
          systemPrompt
        )
      }

      try {
        const sourceId = await ensureSourceId(conversationId)
        if (sourceId) await window.api.setChatProject(sourceId, titles)
      } catch (error) {
        console.error('[chat] setChatProject failed:', error)
      }
    })()
  }

  function attachProject(id: string): void {
    if (attachedProjects.some((p) => p.id === id)) return
    const project = projects.find((p) => p.id === id)
    if (project) applyAttachment(attachedProjects.concat(project))
  }

  function removeAttachedProject(id: string): void {
    applyAttachment(attachedProjects.filter((p) => p.id !== id))
  }

  function deleteConversation(id: number): void {
    const chat = allConversations.find((c) => c.id === id)
    if (!chat) return

    const sessionId = sessionIdByConversation.current.get(id)
    if (sessionId) {
      void window.api.stopClaudeSession(sessionId).catch(() => {})
      sessionIdByConversation.current.delete(id)
    }

    setConversations((prev) => prev.filter((c) => c.id !== id))
    setNotionChats((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) {
      setActiveId(null)
      /* The chips belong to the chat, not to the composer — leaving them behind would attach the
         deleted chat's projects to whatever is started next. */
      setAttachedProjects([])
    }

    const archive = async (): Promise<void> => {
      const sourceId = chat.sourceId ?? (await ensureSourceId(id))
      if (!sourceId) return
      await window.api.archiveChatPage(sourceId)
    }
    archive().catch((error) => console.error('[chat] archiveChatPage failed:', error))
  }

  function selectConversation(id: number): void {
    setActiveId(id)
    setRoute('home')
    /* The pickers follow the chat, so reopening one restores the model and effort it was using. */
    const chat = allConversations.find((c) => c.id === id)
    if (chat) {
      setModelId(chat.model || DEFAULT_MODEL_ID)
      setEffortId(chat.effort || DEFAULT_EFFORT_ID)
      /* The chips are the only place an attachment is shown, so they have to follow the chat too —
         they are its live set, not a staging area for the next message. */
      setAttachedProjects(projectsForTitles(chat.referencedProjectTitles ?? []))
    }
    const notionChat = notionChats.find((c) => c.id === id)
    if (notionChat) loadTranscript(notionChat)
  }

  async function send(): Promise<void> {
    const text = draft.trim()
    if (!text || streamingId !== null) return

    const conversationId = activeId ?? createConversation()
    const conv = allConversations.find((c) => c.id === conversationId) ?? null
    const sessionId = sessionIdByConversation.current.get(conversationId)
    if (!sessionId) {
      console.error('[chat] no session id for conversation', conversationId)
      return
    }

    /* The attached set is the whole story now: it is what the system prompt is assembled from, and
       the system prompt is replaced wholesale at every spawn. Nothing is per-turn any more — a
       project detached before this send contributes nothing to it. */
    const projectTitlesForNotion = attachedProjects.map((p) => p.title)

    const userParts: MessagePart[] = textPart(text)
    const sendText = text
    /* Reassemble when the cache is missing (a reopened chat) or when any attached project has been
       edited since it was built — in Notion, or by another chat that this project has attached. The
       stamp costs three API calls against the context's three-plus-N, so checking every send is
       cheaper than being wrong. */
    let systemPrompt = conv?.systemPrompt ?? ''
    let contextVersions = conv?.contextVersions
    if (conv?.systemPrompt === undefined) {
      ({ systemPrompt, versions: contextVersions } = await assembleSystemPrompt(attachedProjects))
    } else if (attachedProjects.length > 0) {
      const fresh = await readVersions(attachedProjects).catch((error) => {
        console.error('[chat] project version check failed:', error)
        return null
      })
      /* A failed check leaves the cache alone: sending stale context beats dropping it. */
      if (fresh && attachedProjects.some((p) => fresh[p.id] !== contextVersions?.[p.id])) {
        ({ systemPrompt, versions: contextVersions } = await assembleSystemPrompt(attachedProjects))
      }
    }

    const userMsg: Message = { id: nextMessageId.current++, role: 'user', parts: userParts }
    const botId = nextMessageId.current++

    /* Placeholder title from the first line, shown instantly — refined moments later by
       refreshTitle() below once the haiku summary comes back. */
    const priorMessages = conv?.messages ?? []
    const placeholderTitle = priorMessages.length ? conv!.title : titleFrom(text)
    patch(conversationId, (c) => ({
      ...c,
      title: placeholderTitle,
      messages: c.messages.concat([userMsg, { id: botId, role: 'assistant', parts: [] }]),
      referencedProjectTitles: projectTitlesForNotion,
      systemPrompt,
      contextVersions
    }))
    setDraft('')
    setStreamingId(conversationId)

    /* Re-title the chat from every user message it now contains — runs on its own isolated
       haiku call, independent of the main conversation, and never blocks sending the prompt.
       The instruction itself is the content of TITLE.md under the Config page (Settings >
       Injection > Title) — no title refresh happens until that page has text. */
    async function refreshTitle(): Promise<void> {
      try {
        const instruction = (await window.api.getTitleMarkdown()).trim()
        if (!instruction) return
        const priorUserTexts = priorMessages
          .filter((m) => m.role === 'user')
          .map((m) => textOf(m.parts).trim())
          .filter(Boolean)
        /* Framed as data to summarize, not as requests to fulfill — a bare list of the user's
           questions read as a to-do list and got answered instead of titled. */
        const transcript = priorUserTexts
          .concat([text])
          .map((t) => `- ${t}`)
          .join('\n')
        const prompt = `Here are messages a user sent in a chat, for context only — do not respond to them:\n\n${transcript}\n\n${instruction}`
        const generated = (await window.api.generateChatTitle(prompt)).trim()
        if (!generated) return
        patch(conversationId, (c) => ({ ...c, title: generated }))
        const sourceId = await ensureSourceId(conversationId)
        if (sourceId) await window.api.updatePageTitle(sourceId, generated)
      } catch (error) {
        console.error('[chat] title generation failed:', error)
      }
    }
    void refreshTitle()

    if (!onSend) return

    streamTarget.current = { conversationId, botId, sessionId }
    streamParts.current = []
    try {
      await onSend(sessionId, sendText, conv?.model ?? modelId, conv?.effort ?? effortId, systemPrompt)
    } catch (error) {
      appendParts({ conversationId, botId, sessionId }, textPart(`\nSomething went wrong: ${String(error)}`))
    } finally {
      streamTarget.current = null
      setStreamingId(null)
    }

    /* Notion carries the index only — which project this chat references, and when it was last
       touched. The messages themselves live in the session transcript. */
    const sourceId = await ensureSourceId(conversationId)
    if (!sourceId) return
    try {
      if (projectTitlesForNotion.length > 0) await window.api.setChatProject(sourceId, projectTitlesForNotion)
      await window.api.updateLastActive(sourceId)
      refreshChatLog()
    } catch (error) {
      console.error('[chat] notion sync failed:', error)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  const outlined = userBubble === 'Outlined'
  const userBubbleStyle: CSSProperties = {
    maxWidth: '76%',
    boxSizing: 'border-box',
    background: outlined ? 'transparent' : '#212121',
    border: outlined ? '1px solid var(--border-default)' : '1px solid transparent',
    color: '#E6E5E2',
    padding: '11px 16px',
    borderRadius: 'var(--radius-lg, 10px)',
    font: 'var(--type-body)',
    fontSize: 'var(--text-md)',
    letterSpacing: 'var(--tracking-tight)',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word'
  }
  const botBubbleStyle: CSSProperties = {
    maxWidth: '100%',
    color: '#E6E5E2',
    font: 'var(--type-body)',
    fontSize: 'var(--text-md)',
    letterSpacing: 'var(--tracking-tight)',
    whiteSpace: 'pre-wrap'
  }
  const toolBadgeStyle: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    verticalAlign: 'middle',
    margin: '2px 4px 8px 0',
    padding: '2px 8px',
    background: 'var(--surface-subtle)',
    borderRadius: 'var(--radius-sm)',
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-sans)',
    letterSpacing: 'var(--tracking-tight)',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    overflow: 'hidden'
  }

  /** Renders a message's parts. */
  function renderParts(parts: MessagePart[]): ReactElement[] {
    const rendered: ReactElement[] = []
    let i = 0
    while (i < parts.length) {
      const part = parts[i]

      if (part.kind === 'tool') {
        const toolIcon = part.name === 'WebSearch' ? 'search' : part.name === 'ToolSearch' ? 'wrench' : null
        rendered.push(
          <span key={i}>
            <span title={part.query} style={toolBadgeStyle}>
              {toolIcon ? <Icon name={toolIcon} size={12} /> : null}
              <strong style={{ fontWeight: 'var(--weight-medium)' }}>{part.name}</strong>
              <span style={{ color: 'var(--text-muted)' }}>
                {part.query.length > 40 ? `${part.query.slice(0, 40)}…` : part.query}
              </span>
            </span>
            <br />
          </span>
        )
      } else {
        rendered.push(<span key={i}>{part.text}</span>)
      }
      i++
    }
    return rendered
  }

  const last = messages[messages.length - 1]
  const streamingHere = streamingId !== null && streamingId === activeId

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--surface-sidebar)',
        fontFamily: 'var(--font-sans)'
      }}
    >
      <TitleBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {settingsOpen ? <SettingsModal onClose={() => setSettingsOpen(false)} /> : null}
      {contextProject ? (
        <ProjectContextModal
          projectId={contextProject.id}
          title={contextProject.title}
          onClose={() => setContextProjectId(null)}
        />
      ) : null}

      <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        {showSidebar && !sidebarCollapsed ? (
          <div
            id="chatsidebar"
            style={{
              position: 'relative',
              flex: '0 0 auto',
              width: sidebarWidth,
              height: '100%',
              minHeight: 0,
              overflow: 'hidden',
              background: 'var(--surface-sidebar)'
            }}
          >
            <Sidebar
              conversations={allConversations.map((c) => ({
                id: c.id,
                title: c.title,
                colors: colorsFor(c.referencedProjectTitles),
                status: sessionStatuses[c.sessionId] ?? 'idle'
              }))}
              activeId={activeId}
              onSelect={selectConversation}
              onNew={startNewChat}
              onDelete={deleteConversation}
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={openProject}
              onNewProject={newProject}
              route={route}
              onNavigate={setRoute}
            />
            <div
              onMouseDown={startSidebarResize}
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: 6,
                height: '100%',
                cursor: 'col-resize',
                background: 'transparent'
              }}
            />
          </div>
        ) : null}

        <main
          style={{
            flex: '1 1 auto',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            height: '100%',
            background: 'var(--surface-app)',
            borderTop: 'var(--hairline)',
            borderLeft: 'var(--hairline)',
            borderTopLeftRadius: 'var(--radius-xl)',
            overflow: 'hidden'
          }}
        >
          {route === 'projects' ? (
          <div
            style={{
              flex: '1 1 auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 24px'
            }}
          >
            <span style={{ font: 'var(--type-body)', color: 'var(--text-faint)' }}>
              Select a project from the sidebar, or start a new one.
            </span>
          </div>
        ) : route === 'project' && activeProjectId ? (
          <ProjectDetailView
            projectId={activeProjectId}
            onBack={() => setRoute('projects')}
            onOpenChat={openChatBySourceId}
            onColorChange={(id, color) =>
              setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, color } : p)))
            }
          />
        ) : (
        <>
        <nav
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-4)',
            padding: '24px 28px 0',
            font: 'var(--weight-semibold) var(--text-sm)/1 var(--font-sans)',
            letterSpacing: 'var(--tracking-tight)',
            /* Messages scroll underneath this bar by design — the fade mask hides them. Being
               positioned, it also paints over them, so without this it eats hover and clicks on
               whatever sits at the top of the scroll area. Nothing in here is interactive. */
            pointerEvents: 'none'
          }}
        >
          <span style={{ color: active ? 'var(--text-primary)' : 'var(--text-faint)' }}>
            {active ? active.title : 'No conversation'}
          </span>
        </nav>
        <div
          ref={scrollRef}
          className="chatscroll"
          onScroll={updateFadeEdges}
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            overflowX: 'hidden',
            maskImage: fadeMask(fadeEdges),
            WebkitMaskImage: fadeMask(fadeEdges)
          }}
        >
          {active && messages.length > 0 ? (
            <div
              style={{
                maxWidth: 'var(--container)',
                margin: '0 auto',
                padding: '16px 24px 28px',
                display: 'flex',
                flexDirection: 'column',
                gap: '26px'
              }}
            >
              {messages.map((m, i) => {
                return (
                  <div
                    key={m.id}
                    ref={i === messages.length - 1 ? lastMessageRef : undefined}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      alignItems: m.role === 'user' ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        width: '100%',
                        justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start'
                      }}
                    >
                      <div style={m.role === 'user' ? userBubbleStyle : botBubbleStyle}>
                        {renderParts(m.parts)}
                        {streamingHere && last && m.id === last.id ? CARET : null}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={spacerRef} style={{ flex: '0 0 auto' }} />
            </div>
          ) : (
            <div
              style={{
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 24px'
              }}
            >
              <span style={{ font: 'var(--type-body)', color: 'var(--text-faint)' }}>
                {active ? 'Send a message to start this conversation.' : 'Start a new conversation to begin.'}
              </span>
            </div>
          )}
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', padding: '0 34px 22px 24px' }}>
          <Composer
            value={draft}
            onChange={setDraft}
            onKeyDown={onKeyDown}
            placeholder=""
            models={MODELS}
            modelId={modelId}
            onSelectModel={selectModel}
            efforts={EFFORTS}
            effortId={effortId}
            defaultEffortId={DEFAULT_EFFORT_ID}
            onSelectEffort={selectEffort}
            projects={projects}
            attached={attachedProjects}
            onSelectProject={attachProject}
            onRemoveProject={removeAttachedProject}
            onOpenProject={setContextProjectId}
            style={{ maxWidth: 'var(--container)', minHeight: '104px' }}
          />
        </div>
        </>
        )}
        </main>
      </div>
    </div>
  )
}
