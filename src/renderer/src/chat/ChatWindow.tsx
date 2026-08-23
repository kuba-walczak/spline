import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react'
import { Composer } from '@/components/ui/composer'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import ProjectDetailView from './ProjectDetailView'

/* Implementation of `Chat Window.dc.html` from the Claude app design system.
   Conversations live in memory only — the app starts empty and nothing survives quit. */

type MessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; query: string }
  | { kind: 'context'; label: string; text: string }

interface Message {
  id: number
  role: 'user' | 'assistant'
  parts: MessagePart[]
}

function textPart(text: string): MessagePart[] {
  return text ? [{ kind: 'text', text }] : []
}

/** Notion contract: { messages: [{ content, tools: [{ name, query }] }] }, alternating from the user. */
interface StoredMessage {
  content: string
  tools: Array<{ name: string; query: string }>
}

function partsToStored(parts: MessagePart[]): StoredMessage {
  return {
    content: parts
      .filter((p): p is { kind: 'text'; text: string } | { kind: 'context'; label: string; text: string } =>
        p.kind === 'text' || p.kind === 'context'
      )
      .map((p) => p.text)
      .join(''),
    tools: parts
      .filter((p): p is { kind: 'tool'; name: string; query: string } => p.kind === 'tool')
      .map((p) => ({ name: p.name, query: p.query }))
  }
}

function storedToParts(message: StoredMessage): MessagePart[] {
  const tools: MessagePart[] = (message.tools ?? []).map((t) => ({ kind: 'tool', name: t.name, query: t.query }))
  return tools.concat(textPart(message.content))
}

interface Conversation {
  id: number
  title: string
  messages: Message[]
  sourceId?: string
  loaded?: boolean
  /** Set the moment a project's context is first injected — the chat is locked to that project from then on. */
  lockedProjectId?: string
  lockedProjectTitle?: string
}

interface Project {
  id: string
  title: string
}

const REPLIES = [
  "Good question. The short answer is that the retrieval step runs before the model call, not during it — so the app has already decided what you'll get before a single token is generated.\n\nIn practice that means the quality of an answer is often set by the retriever, not the model.",
  "Roughly, yes. The app keeps a running budget for the window and spends it in priority order: system prompt first, then pinned or project context, then recent turns, then whatever similarity search returns.\n\nAnything that doesn't fit gets summarised or dropped.",
  "It depends on where the truncation happens. Dropping the oldest turns is cheap and predictable; summarising them keeps more meaning but introduces a lossy step you can't audit later.\n\nMost production systems do both, at different thresholds."
]

const CARET = '▍'
const UNTITLED = 'New chat'

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
  const [draft, setDraft] = useState('')
  const [streamingId, setStreamingId] = useState<number | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
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

  function refreshChatLog(): void {
    window.api
      .getChatLog()
      .then((entries) => {
        setNotionChats((prev) => {
          const bySourceId = new Map(prev.map((c) => [c.sourceId, c]))
          return entries.map((entry) => {
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
              sourceId: entry.id
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
        setProjects(entries.map((entry) => ({ id: entry.id, title: entry.title || 'Untitled' })))
      })
      .catch((error) => console.error('[projects] getProjects failed:', error))
  }

  useEffect(() => {
    refreshChatLog()
    refreshProjects()
  }, [])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  useEffect(() => {
    notionChatsRef.current = notionChats
  }, [notionChats])

  const allConversations = notionChats.concat(conversations)
  const active = allConversations.find((c) => c.id === activeId) ?? null
  const messages = active ? active.messages : []

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, activeId])

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
        patch(chat.id, (c) => ({ ...c, messages: loadedMessages }))
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
    if (active?.lockedProjectId) return
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

    const wasLocked = Boolean(active?.lockedProjectId)
    const conversationId = activeId ?? createConversation()
    const projectsToInject = attachedProjects
    const lockProject = !wasLocked && projectsToInject.length > 0 ? projectsToInject[0] : null

    let userParts: MessagePart[] = textPart(text)
    let sendText = text

    if (projectsToInject.length > 0) {
      try {
        const contexts = await Promise.all(
          projectsToInject.map(async (p) => ({ title: p.title, text: await window.api.getProjectContext(p.id) }))
        )
        const nonEmpty = contexts.filter((c) => c.text.trim().length > 0)
        if (nonEmpty.length > 0) {
          const contextParts: MessagePart[] = nonEmpty.map((c) => ({
            kind: 'context',
            label: c.title,
            text: `[${c.title}]\n${c.text.trim()}`
          }))
          sendText = nonEmpty.map((c) => `[${c.title}]\n${c.text.trim()}`).join('\n\n') + '\n\n' + text
          userParts = contextParts.concat(textPart(text))
        }
      } catch (error) {
        console.error('[chat] getProjectContext failed:', error)
      }
    }

    const userMsg: Message = { id: nextMessageId.current++, role: 'user', parts: userParts }
    const botId = nextMessageId.current++

    let title: string | null = null
    patch(conversationId, (c) => {
      title = c.messages.length === 0 ? titleFrom(text) : c.title
      return {
        ...c,
        title,
        messages: c.messages.concat([userMsg, { id: botId, role: 'assistant', parts: [] }]),
        ...(lockProject ? { lockedProjectId: lockProject.id, lockedProjectTitle: lockProject.title } : {})
      }
    })
    setDraft('')
    setAttachedProjects([])
    setStreamingId(conversationId)

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
      if (sourceId && finalText !== null) {
        try {
          const assistantParts = streamParts.current.length > 0 ? streamParts.current : textPart(finalText)
          await window.api.appendMessages(sourceId, [partsToStored(userParts), partsToStored(assistantParts)])
          if (title) await window.api.updatePageTitle(sourceId, title)
          if (lockProject) await window.api.setChatProject(sourceId, lockProject.title)
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
    whiteSpace: 'pre-wrap'
  }
  const botBubbleStyle: CSSProperties = {
    maxWidth: '100%',
    color: '#E6E5E2',
    font: 'var(--type-body)',
    fontSize: 'var(--text-md)',
    letterSpacing: 'var(--tracking-tight)',
    whiteSpace: 'pre-wrap'
  }
  const contextBlockStyle: CSSProperties = {
    display: 'block',
    margin: '0 0 10px',
    padding: '8px 10px',
    background: 'var(--surface-subtle)',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-muted)',
    font: 'var(--type-meta)',
    letterSpacing: 'var(--tracking-tight)',
    whiteSpace: 'pre-wrap',
    maxHeight: 160,
    overflowY: 'auto'
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
        background: 'var(--surface-app)',
        fontFamily: 'var(--font-sans)'
      }}
    >
      <TitleBar
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
      />

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
              conversations={allConversations}
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
            borderTopLeftRadius: 'var(--radius-xl)'
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
          <ProjectDetailView projectId={activeProjectId} onBack={() => setRoute('projects')} />
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
        <div ref={scrollRef} className="chatscroll chatscroll-fade" style={{ flex: '1 1 auto', overflowY: 'auto', overflowX: 'hidden' }}>
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
              {messages.map((m) => (
                <div
                  key={m.id}
                  style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}
                >
                  <div style={m.role === 'user' ? userBubbleStyle : botBubbleStyle}>
                    {m.parts.map((part, i) =>
                      part.kind === 'context' ? (
                        <span key={i} style={contextBlockStyle}>
                          {part.text}
                        </span>
                      ) : part.kind === 'tool' ? (
                        <span key={i}>
                          <span title={part.query} style={toolBadgeStyle}>
                            <strong style={{ fontWeight: 'var(--weight-medium)' }}>{part.name}</strong>
                            <span style={{ color: 'var(--text-muted)' }}>
                              {part.query.length > 40 ? `${part.query.slice(0, 40)}…` : part.query}
                            </span>
                          </span>
                          <br />
                        </span>
                      ) : (
                        <span key={i}>{part.text}</span>
                      )
                    )}
                    {streamingHere && last && m.id === last.id ? CARET : null}
                  </div>
                </div>
              ))}
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
            model="Opus 5"
            effort="High"
            projects={projects}
            attached={attachedProjects}
            onSelectProject={attachProject}
            onRemoveProject={removeAttachedProject}
            lockedProject={
              active?.lockedProjectId
                ? { id: active.lockedProjectId, title: active.lockedProjectTitle ?? '' }
                : undefined
            }
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
