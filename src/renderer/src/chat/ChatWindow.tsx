import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react'
import { Composer } from '@/components/ui/composer'
import { IconButton } from '@/components/ui/icon-button'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import ProjectsView from './ProjectsView'

/* Implementation of `Chat Window.dc.html` from the Claude app design system.
   Conversations live in memory only — the app starts empty and nothing survives quit. */

type MessagePart = { kind: 'text'; text: string } | { kind: 'tool'; name: string; query: string }

interface Message {
  id: number
  role: 'user' | 'assistant'
  parts: MessagePart[]
}

function textPart(text: string): MessagePart[] {
  return text ? [{ kind: 'text', text }] : []
}

function partsToPlainText(parts: MessagePart[]): string {
  return parts.map((p) => (p.kind === 'text' ? p.text : `\`${p.name}(${p.query})\``)).join('')
}

interface Conversation {
  id: number
  title: string
  messages: Message[]
  sourceId?: string
  loaded?: boolean
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [draft, setDraft] = useState('')
  const [streamingId, setStreamingId] = useState<number | null>(null)
  const [refreshingChatLog, setRefreshingChatLog] = useState(false)
  const [bumpingLastActive, setBumpingLastActive] = useState(false)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const nextConversationId = useRef(1)
  const nextMessageId = useRef(1)
  const nextNotionId = useRef(-1)
  const notionIdBySourceId = useRef(new Map<string, number>())
  const replyIndex = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamTarget = useRef<{ conversationId: number; botId: number } | null>(null)
  const conversationsRef = useRef<Conversation[]>([])
  const notionChatsRef = useRef<Conversation[]>([])
  const pendingPageId = useRef(new Map<number, Promise<string>>())

  function refreshChatLog(): void {
    setRefreshingChatLog(true)
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
      .finally(() => setRefreshingChatLog(false))
  }

  useEffect(() => {
    refreshChatLog()
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

  function appendParts(target: { conversationId: number; botId: number }, newParts: MessagePart[]): void {
    patch(target.conversationId, (c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== target.botId) return m
        const parts = m.parts.slice()
        for (const part of newParts) {
          const lastPart = parts[parts.length - 1]
          if (part.kind === 'text' && lastPart?.kind === 'text') {
            parts[parts.length - 1] = { kind: 'text', text: lastPart.text + part.text }
          } else {
            parts.push(part)
          }
        }
        return { ...m, parts }
      })
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
          parts: textPart(row.text)
        }))
        patch(chat.id, (c) => ({ ...c, messages: loadedMessages }))
      })
      .catch((error) => {
        console.error('[chat] getChatTranscript failed:', error)
        patch(chat.id, (c) => ({ ...c, loaded: false }))
      })
  }

  async function bumpLastActiveIfChanged(): Promise<void> {
    if (!active?.sourceId || bumpingLastActive || streamingId === active.id) return
    const sourceId = active.sourceId
    if (active.messages.length === 0) return

    setBumpingLastActive(true)
    try {
      const remote = await window.api.getChatTranscript(sourceId)
      const newMessages = active.messages
        .slice(remote.length)
        .map((m) => ({ role: m.role, text: partsToPlainText(m.parts) }))

      if (newMessages.length > 0) {
        await window.api.appendMessages(sourceId, newMessages)
        await window.api.updateLastActive(sourceId)
        refreshChatLog()
      }
    } catch (error) {
      console.error('[chat] bumpLastActiveIfChanged failed:', error)
    } finally {
      setBumpingLastActive(false)
    }
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
    const userMsg: Message = { id: nextMessageId.current++, role: 'user', parts: textPart(text) }
    const botId = nextMessageId.current++

    let title: string | null = null
    patch(conversationId, (c) => {
      title = c.messages.length === 0 ? titleFrom(text) : c.title
      return { ...c, title, messages: c.messages.concat([userMsg, { id: botId, role: 'assistant', parts: [] }]) }
    })
    setDraft('')
    setStreamingId(conversationId)

    if (onSend) {
      streamTarget.current = { conversationId, botId }
      let finalText: string | null = null
      try {
        finalText = await onSend(text)
      } catch (error) {
        appendParts({ conversationId, botId }, textPart(`\nSomething went wrong: ${String(error)}`))
      } finally {
        streamTarget.current = null
        setStreamingId(null)
      }

      const sourceId = await ensureSourceId(conversationId)
      if (sourceId && finalText !== null) {
        try {
          await window.api.appendMessages(sourceId, [
            { role: 'user', text },
            { role: 'assistant', text: finalText }
          ])
          if (title) await window.api.updatePageTitle(sourceId, title)
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
    background: outlined ? 'transparent' : 'var(--surface-control)',
    border: outlined ? '1px solid var(--border-default)' : '1px solid transparent',
    color: 'var(--text-body)',
    padding: '11px 16px',
    borderRadius: 'var(--radius-lg, 10px)',
    font: 'var(--type-body)',
    letterSpacing: 'var(--tracking-tight)',
    whiteSpace: 'pre-wrap'
  }
  const botBubbleStyle: CSSProperties = {
    maxWidth: '100%',
    color: 'var(--text-body)',
    font: 'var(--type-body)',
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

  const last = messages[messages.length - 1]
  const streamingHere = streamingId !== null && streamingId === activeId

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--surface-app)',
        fontFamily: 'var(--font-sans)'
      }}
    >
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
            route={route}
            onNavigate={setRoute}
          />
        </div>
      ) : null}

      <main
        style={{
          flex: '1 1 auto',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100%',
          background: 'var(--surface-app)'
        }}
      >
        <TitleBar
          icon={route === 'projects' ? undefined : active ? 'message-circle' : undefined}
          title={route === 'projects' ? undefined : active ? active.title : 'No conversation'}
          muted={!active}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          action={
            route !== 'projects' && active?.sourceId ? (
              <IconButton
                icon="refresh-cw"
                label="Sync new messages to Notion"
                size="sm"
                onClick={() => void bumpLastActiveIfChanged()}
                disabled={bumpingLastActive || refreshingChatLog}
              />
            ) : null
          }
        />

        {route === 'projects' ? <ProjectsView /> : (
        <>
        <div ref={scrollRef} className="chatscroll" style={{ flex: '1 1 auto', overflowY: 'auto', overflowX: 'hidden' }}>
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
                      part.kind === 'tool' ? (
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

        <div style={{ flex: '0 0 auto', display: 'flex', justifyContent: 'center', padding: '0 24px 22px' }}>
          <Composer
            value={draft}
            onChange={setDraft}
            onKeyDown={onKeyDown}
            placeholder={active ? 'Reply to Claude…' : 'Message Claude…'}
            model="Opus 5"
            effort="High"
            style={{ maxWidth: 'var(--container)', minHeight: '104px' }}
          />
        </div>
        </>
        )}
      </main>
    </div>
  )
}
