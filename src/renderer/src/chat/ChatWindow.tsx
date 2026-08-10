import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactElement } from 'react'
import { Composer } from '@/components/ui/composer'
import { Icon } from '@/components/ui/icon'
import { Sidebar } from './Sidebar'

/* Implementation of `Chat Window.dc.html` from the Claude app design system.
   Conversations live in memory only — the app starts empty and nothing survives quit. */

interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
}

interface Conversation {
  id: number
  title: string
  messages: Message[]
}

const REPLIES = [
  "Good question. The short answer is that the retrieval step runs before the model call, not during it — so the app has already decided what you'll get before a single token is generated.\n\nIn practice that means the quality of an answer is often set by the retriever, not the model.",
  "Roughly, yes. The app keeps a running budget for the window and spends it in priority order: system prompt first, then pinned or project context, then recent turns, then whatever similarity search returns.\n\nAnything that doesn't fit gets summarised or dropped.",
  "It depends on where the truncation happens. Dropping the oldest turns is cheap and predictable; summarising them keeps more meaning but introduces a lossy step you can't audit later.\n\nMost production systems do both, at different thresholds."
]

const CARET = '▍'
const UNTITLED = 'New chat'

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

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties

export default function ChatWindow({
  showSidebar = true,
  userBubble = 'Filled',
  streamSpeed = 22,
  onSend
}: ChatWindowProps): ReactElement {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [streamingId, setStreamingId] = useState<number | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const nextConversationId = useRef(1)
  const nextMessageId = useRef(1)
  const replyIndex = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const active = conversations.find((c) => c.id === activeId) ?? null
  const messages = active ? active.messages : []

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, activeId])

  useEffect(() => () => clearTimer(), [])

  function clearTimer(): void {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  function patch(id: number, fn: (c: Conversation) => Conversation): void {
    setConversations((prev) => prev.map((c) => (c.id === id ? fn(c) : c)))
  }

  function createConversation(): number {
    const id = nextConversationId.current++
    setConversations((prev) => prev.concat({ id, title: UNTITLED, messages: [] }))
    setActiveId(id)
    setDraft('')
    return id
  }

  function selectConversation(id: number): void {
    setActiveId(id)
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
        messages: c.messages.map((m) => (m.id === botId ? { ...m, text: full.slice(0, at) } : m))
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
    const userMsg: Message = { id: nextMessageId.current++, role: 'user', text }
    const botId = nextMessageId.current++

    patch(conversationId, (c) => ({
      ...c,
      title: c.messages.length === 0 ? titleFrom(text) : c.title,
      messages: c.messages.concat([userMsg, { id: botId, role: 'assistant', text: '' }])
    }))
    setDraft('')
    setStreamingId(conversationId)

    let full: string
    if (onSend) {
      try {
        full = await onSend(text)
      } catch (error) {
        full = `Something went wrong: ${String(error)}`
      }
    } else {
      full = REPLIES[replyIndex.current % REPLIES.length]
      replyIndex.current++
    }
    stream(conversationId, botId, full)
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
      {showSidebar ? (
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
            conversations={conversations}
            activeId={activeId}
            onSelect={selectConversation}
            onNew={createConversation}
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
        <header
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            height: '52px',
            /* Right inset clears the native window-control overlay when there is one. */
            padding: '0 calc(100vw - env(titlebar-area-width, 100vw) + 16px) 0 20px',
            ...dragStyle
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
            {active ? <Icon name="message-circle" size={16} /> : null}
            <span
              style={{
                font: 'var(--weight-medium) var(--text-base)/1.2 var(--font-sans)',
                letterSpacing: 'var(--tracking-tight)',
                color: active ? 'var(--text-primary)' : 'var(--text-faint)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {active ? active.title : 'No conversation'}
            </span>
          </div>
        </header>

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
                    {streamingHere && last && m.id === last.id ? m.text + CARET : m.text}
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
      </main>
    </div>
  )
}
