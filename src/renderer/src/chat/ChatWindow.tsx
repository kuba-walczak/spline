import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react'
import { Composer } from '@/components/ui/composer'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import { SettingsModal } from './SettingsModal'
import ProjectDetailView from './ProjectDetailView'
import { Icon } from '@/components/ui/icon'

/* Implementation of `Chat Window.dc.html` from the Claude app design system.
   Conversations live in memory only — the app starts empty and nothing survives quit. */

type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; query: string }
  /** `persist: false` marks a project re-injected while priming a resumed chat — shown in the UI as a
      bubble (the context really is being sent to Claude this turn) but not recorded to the Notion
      transcript's `projects` list, since it's already on record from when the project was first attached. */
  | { kind: 'context'; label: string; text: string; persist?: boolean }
  | { kind: 'injection'; label: string; text: string }
  | { kind: 'transcript'; label: string; text: string }

interface Message {
  id: number
  role: 'user' | 'assistant'
  parts: MessagePart[]
}

function textPart(text: string): MessagePart[] {
  return text ? [{ kind: 'text', text }] : []
}

/** Notion contract: { messages: [{ content, tools: [{ name, query }], projects }] }, alternating from the user. */
interface StoredMessage {
  content: string
  tools: Array<{ name: string; query: string }>
  /** Titles of the projects injected into this message. */
  projects: string[]
}

function partsToStored(parts: MessagePart[]): StoredMessage {
  const contextParts = parts.filter(
    (p): p is { kind: 'context'; label: string; text: string; persist?: boolean } => p.kind === 'context'
  )
  return {
    content: parts
      .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
      .map((p) => p.text)
      .join(''),
    tools: parts
      .filter((p): p is { kind: 'tool'; name: string; query: string } => p.kind === 'tool')
      .map((p) => ({ name: p.name, query: p.query })),
    projects: contextParts.filter((p) => p.persist !== false).map((p) => p.label)
  }
}

function storedToParts(message: StoredMessage): MessagePart[] {
  const projects: MessagePart[] = (message.projects ?? []).map((title) => ({ kind: 'context', label: title, text: title }))
  const tools: MessagePart[] = (message.tools ?? []).map((t) => ({ kind: 'tool', name: t.name, query: t.query }))
  return projects.concat(tools).concat(textPart(message.content))
}

/** Flattens a resumed conversation's prior turns to plain text — what gets pasted back to a fresh CLI process
    that lost the conversation when the app restarted. */
function messagesToTranscriptText(messages: Message[]): string {
  return messages
    .map((m) => ({ role: m.role === 'user' ? 'User' : 'Assistant', content: partsToStored(m.parts).content.trim() }))
    .filter((m) => m.content.length > 0)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n\n')
}

interface Conversation {
  id: number
  title: string
  messages: Message[]
  sourceId?: string
  loaded?: boolean
  /** Titles of every project ever injected into this conversation — drives the sidebar tint and locks
      that project's attach option so it can't be added again. */
  referencedProjectTitles?: string[]
}

function unionTitles(existing: string[] | undefined, added: string[]): string[] {
  return Array.from(new Set((existing ?? []).concat(added)))
}

interface Project {
  id: string
  title: string
  color: string | null
}

const REPLIES = [
  "Good question. The short answer is that the retrieval step runs before the model call, not during it — so the app has already decided what you'll get before a single token is generated.\n\nIn practice that means the quality of an answer is often set by the retriever, not the model.",
  "Roughly, yes. The app keeps a running budget for the window and spends it in priority order: system prompt first, then pinned or project context, then recent turns, then whatever similarity search returns.\n\nAnything that doesn't fit gets summarised or dropped.",
  "It depends on where the truncation happens. Dropping the oldest turns is cheap and predictable; summarising them keeps more meaning but introduces a lossy step you can't audit later.\n\nMost production systems do both, at different thresholds."
]

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
const DEFAULT_EFFORT_ID = 'medium'

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
  /** Messages — reply stream rate, chars/s. */
  streamSpeed?: number
  /** Resolve the assistant reply for a sent message. Defaults to the canned deck. */
  onSend?: (text: string) => Promise<string>
}


export default function ChatWindow({
  showSidebar = true,
  userBubble = 'Filled',
  streamSpeed = 22,
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [streamingId, setStreamingId] = useState<number | null>(null)
  const [modelId, setModelId] = useState('sonnet')
  const [effortId, setEffortId] = useState(DEFAULT_EFFORT_ID)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastMessageRef = useRef<HTMLDivElement | null>(null)
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const [fadeEdges, setFadeEdges] = useState({ top: false, bottom: false })

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
  const replyIndex = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamTarget = useRef<{ conversationId: number; botId: number } | null>(null)
  const streamParts = useRef<MessagePart[]>([])
  const conversationsRef = useRef<Conversation[]>([])
  const notionChatsRef = useRef<Conversation[]>([])
  const pendingPageId = useRef(new Map<number, Promise<string>>())
  /** Notion chat sourceIds whose transcript has already been pasted back to the CLI process this app session. */
  const primedSourceIds = useRef(new Set<string>())

  function refreshChatLog(): void {
    window.api
      .getChatLog()
      .then((entries) => {
        setNotionChats((prev) => {
          const bySourceId = new Map(prev.map((c) => [c.sourceId, c]))
          const localSourceIds = new Set(conversationsRef.current.map((c) => c.sourceId).filter(Boolean))
          return entries
            .filter((entry) => !localSourceIds.has(entry.id))
            .map((entry) => {
              const existing = bySourceId.get(entry.id)
              let id = notionIdBySourceId.current.get(entry.id)
              if (id === undefined) {
                id = nextNotionId.current--
                notionIdBySourceId.current.set(entry.id, id)
              }
              return {
                id,
                title: entry.name,
                messages: existing?.messages ?? [],
                loaded: existing?.loaded,
                sourceId: entry.id,
                referencedProjectTitles: unionTitles(existing?.referencedProjectTitles, entry.projects)
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
    window.api.getClaudeModel().then(setModelId).catch((error) => console.error('[claude] getClaudeModel failed:', error))
    window.api.getClaudeEffort().then(setEffortId).catch((error) => console.error('[claude] getClaudeEffort failed:', error))
  }, [])

  function selectModel(id: string): void {
    setModelId(id)
    window.api.setClaudeModel(id).catch((error) => console.error('[claude] setClaudeModel failed:', error))
  }

  function selectEffort(id: string): void {
    setEffortId(id)
    window.api.setClaudeEffort(id).catch((error) => console.error('[claude] setClaudeEffort failed:', error))
  }

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  useEffect(() => {
    notionChatsRef.current = notionChats
  }, [notionChats])

  const allConversations = notionChats.concat(conversations)

  function colorsFor(titles: string[] | undefined): string[] {
    if (!titles || titles.length === 0) return []
    const byTitle = new Map(projects.map((p) => [p.title, p.color]))
    return Array.from(new Set(titles.map((t) => byTitle.get(t)).filter((c): c is string => Boolean(c))))
  }

  /** Projects already referenced by a chat — offered as locked, non-removable badges so they can't be re-attached. */
  function lockedProjectsFor(titles: string[] | undefined): Project[] {
    if (!titles || titles.length === 0) return []
    const byTitle = new Map(projects.map((p) => [p.title, p]))
    return titles.map((t) => byTitle.get(t)).filter((p): p is Project => Boolean(p))
  }
  const active = allConversations.find((c) => c.id === activeId) ?? null
  const messages = active ? active.messages : []

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
    if (!window.api.onClaudeEvent) return
    return window.api.onClaudeEvent((event) => {
      const target = streamTarget.current
      if (!target) return
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

  function appendParts(target: { conversationId: number; botId: number }, newParts: MessagePart[]): void {
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

  function loadTranscript(chat: Conversation): void {
    if (!chat.sourceId || chat.loaded) return

    patch(chat.id, (c) => ({ ...c, loaded: true }))
    window.api
      .getChatTranscript(chat.sourceId)
      .then((rows) => {
        const loadedMessages = rows.map((row) => ({
          id: nextMessageId.current++,
          role: row.role,
          parts: storedToParts(row)
        }))
        const referenced = rows.flatMap((row) => row.projects ?? [])
        patch(chat.id, (c) => ({
          ...c,
          messages: loadedMessages,
          referencedProjectTitles: unionTitles(c.referencedProjectTitles, referenced)
        }))
      })
      .catch((error) => {
        console.error('[chat] getChatTranscript failed:', error)
        patch(chat.id, (c) => ({ ...c, loaded: false }))
      })
  }

  function createConversation(): number {
    const id = nextConversationId.current++
    setConversations((prev) => prev.concat({ id, title: UNTITLED, messages: [] }))
    setActiveId(id)
    setDraft('')
    setRoute('home')

    const pagePromise = window.api
      .createChatPage(UNTITLED)
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

  function attachProject(id: string): void {
    setAttachedProjects((prev) => {
      if (prev.some((p) => p.id === id)) return prev
      const project = projects.find((p) => p.id === id)
      return project ? prev.concat(project) : prev
    })
  }

  function removeAttachedProject(id: string): void {
    setAttachedProjects((prev) => prev.filter((p) => p.id !== id))
  }

  function deleteConversation(id: number): void {
    const chat = allConversations.find((c) => c.id === id)
    if (!chat) return

    setConversations((prev) => prev.filter((c) => c.id !== id))
    setNotionChats((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) setActiveId(null)

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
    const chat = notionChats.find((c) => c.id === id)
    if (chat) loadTranscript(chat)
  }

  function stream(conversationId: number, botId: number, full: string): void {
    let i = 0
    const speed = Math.max(4, Math.round(streamSpeed))
    clearTimer()
    timer.current = setInterval(() => {
      i = Math.min(full.length, i + 2)
      const at = i
      patch(conversationId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === botId ? { ...m, parts: textPart(full.slice(0, at)) } : m))
      }))
      if (at >= full.length) {
        clearTimer()
        setStreamingId(null)
      }
    }, 1000 / speed)
  }

  async function send(): Promise<void> {
    const text = draft.trim()
    if (!text || streamingId !== null) return

    const conversationId = activeId ?? createConversation()
    const conv = allConversations.find((c) => c.id === conversationId) ?? null
    const projectsToInject = attachedProjects
    const projectTitlesForNotion = unionTitles(conv?.referencedProjectTitles, projectsToInject.map((p) => p.title))

    /* A conversation reloaded from Notion (app restart, or switching back to it) has messages the headless
       CLI process has never seen — it's a fresh process with no memory of this chat. Prime it once per app
       session by pasting the transcript back in, alongside every referenced project's instructions. */
    const priorMessages = conv?.messages ?? []
    const needsPriming = Boolean(conv?.sourceId) && priorMessages.length > 0 && !primedSourceIds.current.has(conv!.sourceId!)
    const transcriptText = needsPriming ? messagesToTranscriptText(priorMessages) : ''
    const resumeProjects = needsPriming
      ? (conv?.referencedProjectTitles ?? [])
          .map((title) => projects.find((p) => p.title === title))
          .filter((p): p is Project => Boolean(p))
          .filter((p) => !projectsToInject.some((ap) => ap.id === p.id))
      : []
    const allProjectsToInject = projectsToInject.concat(resumeProjects)

    let userParts: MessagePart[] = textPart(text)
    let sendText = text

    /* Project guidelines whenever a project is attached (directly or via resume) — every such send, since
       attaching a project is itself a deliberate per-message action. Chat guidelines only when a fresh
       headless CLI process is also resuming a conversation it has no memory of — the transcript-priming
       moment — not on a brand-new chat's first prompt, which has no prior context to accompany. Order,
       matching the badges: Project guidelines, project(s), Chat guidelines, Chat title. */
    const hasProjects = allProjectsToInject.length > 0
    const freshProcess = await window.api.claudeConsumeNeedsGuidelines()
    const wantsChatGuidelines = freshProcess && needsPriming

    try {
      const [projectGuidelines, chatGuidelines, contexts] = await Promise.all([
        hasProjects ? window.api.getProjectMarkdown() : Promise.resolve(''),
        wantsChatGuidelines ? window.api.getChatMarkdown() : Promise.resolve(''),
        Promise.all(allProjectsToInject.map(async (p) => ({ title: p.title, text: await window.api.getProjectContext(p.id) })))
      ])
      const nonEmpty = contexts.filter((c) => c.text.trim().length > 0)
      if (nonEmpty.length > 0 || projectGuidelines.trim() || chatGuidelines.trim() || transcriptText) {
        const projectGuidelinesPart: MessagePart[] = projectGuidelines.trim()
          ? [{ kind: 'injection', label: 'Project guidelines', text: projectGuidelines.trim() }]
          : []
        /* A project already recorded on this conversation (attached earlier, or re-injected only because
           the headless process needed priming again) still gets a bubble here — the context really is being
           sent to Claude this turn — but isn't re-recorded to the Notion transcript's `projects` list, since
           it's already on record from when it was first attached. Claude gets the full context either way,
           via `blocks` below. */
        const alreadyReferenced = new Set(conv?.referencedProjectTitles ?? [])
        const contextParts: MessagePart[] = nonEmpty.map((c) => ({
          kind: 'context',
          label: c.title,
          text: `${c.title}\n\n${c.text.trim()}`,
          persist: !alreadyReferenced.has(c.title)
        }))
        const chatGuidelinesPart: MessagePart[] = chatGuidelines.trim()
          ? [{ kind: 'injection', label: 'Chat guidelines', text: chatGuidelines.trim() }]
          : []
        const transcriptPart: MessagePart[] = transcriptText
          ? [{ kind: 'transcript', label: conv?.title || UNTITLED, text: transcriptText }]
          : []
        const blocks = [
          projectGuidelines.trim(),
          ...nonEmpty.map((c) => `${c.title}\n\n${c.text.trim()}`),
          chatGuidelines.trim(),
          transcriptText ? `Conversation so far:\n\n${transcriptText}` : ''
        ].filter(Boolean)
        sendText = blocks.length > 0 ? blocks.join('\n\n') + '\n\n' + text : text
        userParts = projectGuidelinesPart
          .concat(contextParts)
          .concat(chatGuidelinesPart)
          .concat(transcriptPart)
          .concat(textPart(text))
      }
    } catch (error) {
      console.error('[chat] getProjectContext failed:', error)
    }

    const userMsg: Message = { id: nextMessageId.current++, role: 'user', parts: userParts }
    const botId = nextMessageId.current++

    /* Placeholder title from the first line, shown instantly — refined moments later by
       refreshTitle() below once the haiku summary comes back. */
    const placeholderTitle = conv?.messages.length ? conv.title : titleFrom(text)
    patch(conversationId, (c) => ({
      ...c,
      title: placeholderTitle,
      messages: c.messages.concat([userMsg, { id: botId, role: 'assistant', parts: [] }]),
      referencedProjectTitles: unionTitles(c.referencedProjectTitles, projectsToInject.map((p) => p.title))
    }))
    setDraft('')
    setAttachedProjects([])
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
          .map((m) => partsToStored(m.parts).content.trim())
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

    if (onSend) {
      streamTarget.current = { conversationId, botId }
      streamParts.current = []
      let finalText: string | null = null
      try {
        finalText = await onSend(sendText)
      } catch (error) {
        appendParts({ conversationId, botId }, textPart(`\nSomething went wrong: ${String(error)}`))
      } finally {
        streamTarget.current = null
        setStreamingId(null)
      }

      const sourceId = await ensureSourceId(conversationId)
      /* The live process now has this turn in its memory (whether this send primed it or it was already
         mid-conversation) — no future send in this session needs to re-inject the transcript for it. */
      if (sourceId) primedSourceIds.current.add(sourceId)
      if (sourceId && finalText !== null) {
        try {
          const assistantParts = streamParts.current.length > 0 ? streamParts.current : textPart(finalText)
          await window.api.appendMessages(sourceId, [partsToStored(userParts), partsToStored(assistantParts)])
          if (projectTitlesForNotion.length > 0) await window.api.setChatProject(sourceId, projectTitlesForNotion)
          await window.api.updateLastActive(sourceId)
          refreshChatLog()
        } catch (error) {
          console.error('[chat] notion sync failed:', error)
        }
      }
    } else {
      const full = REPLIES[replyIndex.current % REPLIES.length]
      replyIndex.current++
      stream(conversationId, botId, full)
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

/** Renders each project-context part (plus the resumed transcript and the global settings prompt, if
    injected) as its own badge, for use in a standalone bubble. */
  function renderContextBadges(parts: MessagePart[]): ReactElement[] {
    return parts
      .filter(
        (p): p is { kind: 'injection' | 'context' | 'transcript'; label: string; text: string } =>
          p.kind === 'injection' || p.kind === 'context' || p.kind === 'transcript'
      )
      .map((part, i) => {
        const icon = part.kind === 'injection' ? 'sliders-horizontal' : part.kind === 'transcript' ? 'message-circle' : 'folder'
        const alignSelf = part.kind === 'injection' && part.label === 'Project guidelines' ? undefined : 'flex-end'
        return (
          <span key={i} title={part.text} style={{ ...toolBadgeStyle, margin: 0, alignSelf }}>
            <Icon name={icon} size={12} />
            <strong style={{ fontWeight: 'var(--weight-medium)' }}>{part.label}</strong>
          </span>
        )
      })
  }

  /** Renders a message's parts. The global injection prompt carries no per-project identity, so it stays silent.
      Project context is handled separately by renderContextBadges, in its own bubble. */
  function renderParts(parts: MessagePart[]): ReactElement[] {
    const rendered: ReactElement[] = []
    let i = 0
    while (i < parts.length) {
      const part = parts[i]

      if (part.kind === 'injection' || part.kind === 'context' || part.kind === 'transcript') {
        i++
        continue
      }

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

      <div style={{ display: 'flex', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
        {showSidebar && !sidebarCollapsed ? (
          <div
            id="chatsidebar"
            style={{
              flex: '0 0 auto',
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
                colors: colorsFor(c.referencedProjectTitles)
              }))}
              activeId={activeId}
              onSelect={selectConversation}
              onNew={createConversation}
              onDelete={deleteConversation}
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={openProject}
              onNewProject={newProject}
              route={route}
              onNavigate={setRoute}
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
            letterSpacing: 'var(--tracking-tight)'
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
                const contextBadges = renderContextBadges(m.parts)
                return (
                  <div
                    key={m.id}
                    ref={i === messages.length - 1 ? lastMessageRef : undefined}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: contextBadges.length > 0 ? '10px' : '6px',
                      alignItems: m.role === 'user' ? 'flex-end' : 'flex-start'
                    }}
                  >
                    {contextBadges.length > 0 ? (
                      <div
                        style={{
                          display: 'flex',
                          width: '100%',
                          justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start'
                        }}
                      >
                        <div style={{ ...botBubbleStyle, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '9px' }}>
                          {contextBadges}
                        </div>
                      </div>
                    ) : null}
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
            lockedProjects={lockedProjectsFor(active?.referencedProjectTitles)}
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
