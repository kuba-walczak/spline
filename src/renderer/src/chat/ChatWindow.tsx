import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { Composer } from '@/components/ui/composer'
import { Sidebar } from './Sidebar'
import { TitleBar } from './TitleBar'
import { SettingsModal } from './SettingsModal'
import { ProjectContextModal } from './ProjectContextModal'
import { InjectionModal } from '@/components/ui/injection-modal'
import { clampPollSeconds, loadPollSeconds, savePollSeconds } from '@/lib/pollInterval'
import { loadExpandTools, saveExpandTools } from '@/lib/expandTools'
import { loadActiveSkills, saveActiveSkills } from '@/lib/activeSkills'
import { usageFromEvent } from '@shared/tokenUsage'
import ProjectDetailView from './ProjectDetailView'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { buildSystemPrompt } from '@shared/injection'
import { isNotionId, normalizeNotionId, sameNotionId } from '@shared/notionId'
import { buildSkillsPrompt, renderSkillInvocation, type Skill } from '@shared/skills'
import SkillDetailView from './SkillDetailView'
import PersonDetailView from './PersonDetailView'
import { outcomeFromToolResult, type ToolOutcome } from '@shared/toolResults'
import type { SessionStatus } from './Sidebar'

/* Implementation of `Chat Window.dc.html` from the Claude app design system.

   Each chat is backed by its own CLI session, identified by a uuid the app mints up front and
   stores on the chat's Notion row. The CLI writes that session's transcript to disk, and the app
   reads it back to render history — so continuing a chat is `--resume`, not replaying context
   into a prompt. Notion holds the index (title, project, session id), never the messages. */

type MessagePart =
  | { kind: 'text'; text: string }
  /** `id` correlates the call with the `tool_result` that answers it, which is where a search's
      sources arrive — one turn later, and on a separate branch of the transcript. */
  | { kind: 'tool'; name: string; query: string; id?: string; outcome?: ToolOutcome }

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
  outcome?: ToolOutcome
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
    if (p.kind === 'tool') {
      return { kind: 'tool' as const, name: p.label || 'tool', query: p.text, outcome: p.outcome }
    }
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
  /** Every project this conversation references, as the chat's Notion row stores them: page ids, or
      titles on a row not written since the app moved off them. Drives the sidebar tint and the
      chips restored when the chat is reopened. Resolve through `projectsForRefs`, never directly. */
  referencedProjectRefs?: string[]
  /** Assembled context for every attached project, as last sent to the CLI's system prompt.
      `undefined` means it has not been assembled yet this run — a reopened chat starts that way and
      builds it on its next send. Deliberately not persisted: it is a cache of what Notion holds, and
      rebuilding it is how an edited project reaches an existing chat. */
  systemPrompt?: string
  /** The projects' version stamps at the moment `systemPrompt` was assembled, keyed by project id.
      Compared against fresh stamps on each send to notice a project edited since. */
  contextVersions?: Record<string, string>
  /** When this chat was last spoken to, as the sidebar's "5 minutes ago" label. Read from Notion at
      startup and moved forward locally on each send. */
  lastActive?: string | null
  /** Persistent skills switched on for this chat, by name. Kept in localStorage rather than on the
      Notion row: it is a per-machine toggle, and the chat database has no column for it. */
  activeSkillNames?: string[]
}

interface Project {
  id: string
  title: string
  color: string | null
}

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
/** Between the pieces of an assembled system prompt. */
const SECTION_BREAK = String.fromCharCode(10, 10)

interface ContentBlock {
  type: string
  name?: string
  input?: unknown
  id?: string
  tool_use_id?: string
  content?: unknown
}

/** Reduces a tool's input object down to just its values — no field names or braces. */
function queryOf(input: unknown): string {
  if (input === null || input === undefined) return ''
  if (typeof input !== 'object') return String(input)
  return Object.values(input as Record<string, unknown>)
    .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)))
    .join(' ')
}

/** Shown while a turn is in flight. The dots cycle 0-3 in a fixed-width slot, so the word does not
    shuffle sideways as they come and go.

    Module scope on purpose: nested inside ChatWindow this would be a new component type on every
    render, restarting its interval each time a tool event arrives. */
function Thinking(): ReactElement {
  const [dots, setDots] = useState(0)

  useEffect(() => {
    const handle = window.setInterval(() => setDots((d) => (d + 1) % 4), 420)
    return () => window.clearInterval(handle)
  }, [])

  return (
    <span style={{ color: 'var(--text-muted)' }}>
      Thinking
      <span style={{ display: 'inline-block', width: '1.4em', textAlign: 'left' }}>{'.'.repeat(dots)}</span>
    </span>
  )
}

/** A tool call as the bubbles render it. */
type ToolPart = Extract<MessagePart, { kind: 'tool' }>

/* What each tool is drawn with. The names are the CLI's own; anything unlisted falls back to the
   wrench, which is the generic "a tool ran" glyph rather than a stand-in for a missing case. */
const TOOL_ICONS: Record<string, string> = {
  WebSearch: 'globe',
  WebFetch: 'globe',
  ToolSearch: 'wrench',
  Bash: 'terminal',
  PowerShell: 'terminal',
  Glob: 'search',
  Grep: 'search',
  Read: 'file-text',
  Write: 'pencil',
  Edit: 'pencil',
  NotebookEdit: 'pencil'
}

function iconForTool(name: string): string {
  return TOOL_ICONS[name] ?? 'wrench'
}

/** One colour for every tool glyph, wherever it appears — the row that announces a call and the
    rows a tool lookup resolves to. Deliberately not a text token: these read as marks beside the
    text rather than as text of their own. */
const TOOL_ICON_COLOR = '#6B6965'

/* `ToolHeader` pads 4px and puts a 10px gap after the icon, so indenting the output panel by
   `4 + size + 10` lines its left edge up with the query above it rather than with the icon. Derived
   from the icon size so the two cannot drift apart. */
const TOOL_ICON_SIZE = 18
const HEADER_PAD_X = 4
const HEADER_GAP = 10
const ROW_GAP = 12
/* Groups sit close together; the reply that follows them is a different kind of thing and gets room
   to separate from the run of tool calls above it. */
const GROUP_GAP = 6
const REPLY_GAP = 20
const OUTPUT_INDENT = HEADER_PAD_X + TOOL_ICON_SIZE + HEADER_GAP


/** Bare host, so a row reads "Demographics of Poland — en.wikipedia.org" rather than a full URL. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** The row a tool call is announced with: its icon, what it was asked, and what came back. Shared
    so a tool lookup and a web search read as the same kind of thing. `onToggle` is what makes it a
    control — a call with nothing to expand into simply omits it, chevron and all. */
function ToolHeader({
  icon,
  query,
  trailing,
  open,
  onToggle
}: {
  icon: string
  query: string
  trailing?: string
  open?: boolean
  onToggle?: () => void
}): ReactElement {
  return (
    <span
      onClick={onToggle}
      title={onToggle ? (open ? 'Hide results' : 'Show results') : undefined}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '0 4px 8px',
        cursor: onToggle ? 'pointer' : 'default',
        font: 'var(--weight-regular) var(--text-base)/1.3 var(--font-sans)',
        letterSpacing: 'var(--tracking-tight)'
      }}
    >
      <span style={{ display: 'inline-flex', flex: '0 0 auto', color: TOOL_ICON_COLOR }}>
        <Icon name={icon} size={TOOL_ICON_SIZE} />
      </span>
      <span
        title={query}
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--text-body)'
        }}
      >
        {query}
      </span>
      {trailing ? <span style={{ flex: '0 0 auto', color: 'var(--text-faint)' }}>{trailing}</span> : null}
      {onToggle ? (
        <span style={{ display: 'inline-flex', flex: '0 0 auto', color: 'var(--text-faint)' }}>
          <Icon
            name="chevron-down"
            size={13}
            style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'var(--transition-control)' }}
          />
        </span>
      ) : null}
    </span>
  )
}

/** A site's own icon, falling back to a globe for hosts that serve none. Sourced from Google's
    favicon endpoint, which means the hosts a search returned are visible to Google — the tradeoff
    for having icons at all, since fetching `/favicon.ico` per host misses as often as it hits. */
function Favicon({ url }: { url: string }): ReactElement {
  const [failed, setFailed] = useState(false)
  const host = hostOf(url)

  if (failed || !host) {
    return (
      <span style={{ display: 'inline-flex', width: 16, justifyContent: 'center', color: 'var(--text-faint)' }}>
        <Icon name="globe" size={14} />
      </span>
    )
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(host)}`}
      alt=""
      width={16}
      height={16}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{ display: 'block', flex: '0 0 auto', borderRadius: '3px' }}
    />
  )
}

/** One web search: the query it ran, and the sources it came back with. The list is capped and
    scrolls rather than growing, so a turn with several searches stays readable. */
/** A run of calls to one tool: named once, with a chevron revealing what each call asked and what
    came back. Every tool renders this way — a search reveals its sources, a tool lookup reveals the
    tool it resolved, everything else reveals just its query.

    Module scope on purpose: nested inside ChatWindow this would be a new component type on every
    render, snapping shut each time a streamed token arrives. */
function ToolGroup({
  name,
  parts,
  defaultOpen,
  gapAfter = GROUP_GAP
}: {
  name: string
  parts: ToolPart[]
  defaultOpen: boolean
  /** Wider when the assistant's reply comes next rather than another tool. */
  gapAfter?: number
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const [hover, setHover] = useState(false)

  /* Follows the preference when it changes, so flipping the switch in settings takes effect on
     what is already on screen rather than only on the next chat opened. A group toggled by hand
     afterwards keeps that state until the preference moves again. */
  useEffect(() => setOpen(defaultOpen), [defaultOpen])

  return (
    <span style={{ display: 'block', margin: `2px 0 ${gapAfter}px` }}>
      <span
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={open ? 'Hide details' : 'Show details'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          marginBottom: '5px',
          cursor: 'pointer',
          font: 'var(--weight-medium) var(--text-base)/1.3 var(--font-sans)',
          letterSpacing: 'var(--tracking-tight)',
          /* Quiet until pointed at — the name labels the group, it is not the point of the row. */
          color: hover ? 'var(--text-primary)' : '#A5A9A9',
          transition: 'var(--transition-control)'
        }}
      >
        {name}
        <Icon
          name="chevron-down"
          size={14}
          style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'var(--transition-control)' }}
        />
      </span>

      {open
        ? parts.map((part, index) => (
            <span key={index} style={{ display: 'block', marginBottom: `${ROW_GAP}px` }}>
              <ToolHeader
                icon={iconForTool(part.name)}
                query={part.query}
                trailing={
                  part.outcome && part.outcome.links.length > 0
                    ? `${part.outcome.links.length} result${part.outcome.links.length === 1 ? '' : 's'}`
                    : undefined
                }
              />
              <ToolOutput outcome={part.outcome} />
            </span>
          ))
        : null}
    </span>
  )
}

/** The panel under a call. One shape for every tool, whatever it returned — a search's sources, the
    tools a lookup resolved, or the raw text anything else came back with. A call still awaiting its
    result gets the panel too, so the layout does not jump when the answer lands. */
function ToolOutput({ outcome }: { outcome?: ToolOutcome }): ReactElement {
  const links = outcome?.links ?? []
  const tools = outcome?.tools ?? []
  const text = outcome?.text ?? ''

  return (
    <span
      className="chatscroll"
      style={{
        display: 'block',
        marginLeft: `${OUTPUT_INDENT}px`,
        maxHeight: '148px',
        overflowY: 'auto',
        padding: '6px',
        background: '#1A1A19',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-lg)'
      }}
    >
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          title={link.url}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            height: '33px',
            padding: '0 8px',
            borderRadius: 'var(--radius-sm)',
            textDecoration: 'none',
            transition: 'var(--transition-control)'
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Favicon url={link.url} />
          <span
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              font: 'var(--weight-regular) var(--text-base)/1 var(--font-sans)',
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--text-body)'
            }}
          >
            {link.title}
          </span>
          <span
            style={{
              flex: '0 0 auto',
              font: 'var(--type-meta)',
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--text-faint)'
            }}
          >
            {hostOf(link.url)}
          </span>
        </a>
      ))}

      {tools.map((tool) => (
        <span
          key={tool}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            height: '33px',
            padding: '0 8px',
            font: 'var(--weight-regular) var(--text-base)/1 var(--font-sans)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-body)'
          }}
        >
          <span style={{ display: 'inline-flex', flex: '0 0 auto', color: TOOL_ICON_COLOR }}>
            <Icon name={iconForTool(tool)} size={TOOL_ICON_SIZE - 2} />
          </span>
          {tool}
        </span>
      ))}

      {text ? (
        <span
          style={{
            display: 'block',
            padding: '4px 8px',
            font: 'var(--weight-regular) var(--text-base)/1.5 var(--font-mono)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            color: 'var(--text-body)'
          }}
        >
          {text}
        </span>
      ) : null}

      {links.length === 0 && tools.length === 0 && !text ? (
        <span
          style={{
            display: 'block',
            padding: '8px',
            font: 'var(--type-meta)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-faint)'
          }}
        >
          No output.
        </span>
      ) : null}
    </span>
  )
}

/** Tool results ride on `user` events, keyed by the `tool_use_id` they answer. */
function resultsFromEvent(event: Record<string, unknown>): Map<string, ToolOutcome> {
  const found = new Map<string, ToolOutcome>()
  if (event.type !== 'user') return found

  const content = (event.message as { content?: ContentBlock[] } | undefined)?.content ?? []
  for (const block of content) {
    if (block.type !== 'tool_result' || !block.tool_use_id) continue
    const outcome = outcomeFromToolResult(block.content)
    if (outcome.links.length > 0 || outcome.tools.length > 0 || outcome.text) {
      found.set(block.tool_use_id, outcome)
    }
  }
  return found
}

function formatEvent(event: Record<string, unknown>): MessagePart[] {
  if (event.type === 'assistant') {
    const content = (event.message as { content?: ContentBlock[] } | undefined)?.content ?? []
    return content
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        kind: 'tool' as const,
        name: block.name ?? 'tool',
        query: queryOf(block.input),
        id: block.id
      }))
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
  const [route, setRoute] = useState('chats')
  const [skills, setSkills] = useState<Skill[]>([])
  const [activeSkillId, setActiveSkillId] = useState<string | null>(null)
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([])
  const [activePersonId, setActivePersonId] = useState<string | null>(null)
  /* Chosen in the composer, applied to the next message only. */
  const [pendingSkill, setPendingSkill] = useState<Skill | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [creatingProject, setCreatingProject] = useState(false)
  const [attachedProjects, setAttachedProjects] = useState<Project[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(308)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pollSeconds, setPollSeconds] = useState(loadPollSeconds)
  const [expandTools, setExpandTools] = useState(loadExpandTools)
  /* The configured system instruction, prepended to every chat's system prompt. Held in a ref because
     `assembleSystemPrompt` reads it from inside async work that may have started before an edit
     landed, and the stale closure value would silently reinstate the old instruction. */
  const systemInstruction = useRef('')
  /* Bumped on a timer purely to force a re-render: the sidebar's age labels are derived from
     `Date.now()` at render time, so nothing else has to change for them to advance. The same
     interval re-reads project titles from Notion. */
  const [, setTick] = useState(0)
  /** Project whose injected context is open in the modal, by id. */
  const [contextProjectId, setContextProjectId] = useState<string | null>(null)
  /** True while the armed skill's instructions are on screen — read off `pendingSkill`, which
      already holds the body, so there is nothing to fetch and nothing to keep in sync. */
  const [showPendingSkill, setShowPendingSkill] = useState(false)

  /* Sending the message disarms the skill, and so does dismissing its chip — both leave the modal
     with nothing to show. Closed from here rather than at each of those call sites, so a future one
     cannot forget and leave the next armed skill opening straight into an open modal. */
  useEffect(() => {
    if (!pendingSkill) setShowPendingSkill(false)
  }, [pendingSkill])
  const [draft, setDraft] = useState('')
  const [streamingId, setStreamingId] = useState<number | null>(null)
  /* Model and effort belong to a chat, not the app. These hold the choice for whichever chat is
     open, and seed the next new one so picking a model carries forward the way a user expects. */
  /** Process lifecycle per session id, driving each sidebar row's dot. Absent means idle. */
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, SessionStatus>>({})
  /** Context held by each session's last turn, in tokens — what the composer's meter draws. Lives
      for the run only: a reopened chat has no reading until its next turn reports one, and a
      guessed bar would be worse than none. */
  const [contextTokens, setContextTokens] = useState<Record<string, number>>({})
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID)
  const [effortId, setEffortId] = useState(DEFAULT_EFFORT_ID)
  /** Plain-text record of everything sent to the CLI (spawn command + stdin writes), keyed by
      session id — the debug terminal's source of truth. */
  const [debugLogs, setDebugLogs] = useState<Record<string, string[]>>({})
  const [debugOpen, setDebugOpen] = useState(false)

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
                referencedProjectRefs: entry.projectRefs,
                lastActive: entry.lastActive,
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
        const next = entries.map((entry) => ({
          id: entry.id,
          title: entry.title || 'Untitled',
          color: entry.color
        }))
        setProjects(next)
        /* Composer chips hold their own copies — without this a rename would land in the sidebar
           and leave the attached chips on the old title until the chat was reopened. */
        setAttachedProjects((prev) =>
          prev.map((attached) => {
            const fresh = next.find((p) => sameNotionId(p.id, attached.id))
            return fresh ?? attached
          })
        )
      })
      .catch((error) => console.error('[projects] getProjects failed:', error))
  }

  useEffect(() => {
    refreshChatLog()
    refreshProjects()
  }, [])

  /* Chats used to be tagged with a project's title, and a title stops matching the moment the
     project is renamed in Notion. Rewriting those rows to hold ids instead is what makes a rename
     safe, so it runs once per launch as soon as the project list is in — and does nothing at all
     once every row has been converted. */
  const migratedProjectRefs = useRef(false)
  useEffect(() => {
    if (projects.length === 0 || migratedProjectRefs.current) return
    migratedProjectRefs.current = true

    void window.api
      .migrateChatProjectRefs(projects.map((p) => ({ id: p.id, title: p.title })))
      .then((count) => {
        if (count > 0) refreshChatLog()
      })
      .catch((error) => console.error('[chat] migrateChatProjectRefs failed:', error))
  }, [projects])

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

  /** Resolves what a chat's row stores back to the projects themselves. Ids are matched as ids, so a
      project renamed in Notion still resolves; a value that is not an id is a title from before the
      switch and is matched by name, which is the one case a rename still breaks.

      Deduplicated by project: a row can hold both representations of the same project, and each has
      to yield one chip and one sidebar folder rather than two. */
  function projectsForRefs(refs: string[]): Project[] {
    const resolved = refs.map((ref) =>
      isNotionId(ref)
        ? projects.find((p) => sameNotionId(p.id, ref))
        : projects.find((p) => p.title === ref)
    )

    return Array.from(
      new Map(
        resolved.filter((p): p is Project => Boolean(p)).map((p) => [normalizeNotionId(p.id), p])
      ).values()
    )
  }

  useEffect(() => {
    const handle = window.setInterval(() => {
      setTick((t) => t + 1)
      refreshProjects()
    }, pollSeconds * 1000)
    return () => window.clearInterval(handle)
  }, [pollSeconds])

  useEffect(() => {
    void loadSystemInstruction()
    refreshSkills()
    refreshPeople()
  }, [])

  function refreshPeople(): void {
    window.api
      .getPeople()
      .then(setPeople)
      .catch((error) => console.error('[people] getPeople failed:', error))
  }

  function createPerson(): void {
    window.api
      .createPerson('Untitled person')
      .then((id) => {
        refreshPeople()
        setActivePersonId(id)
        setRoute('person')
      })
      .catch((error) => console.error('[people] createPerson failed:', error))
  }

  function deletePerson(id: string): void {
    window.api
      .archivePerson(id)
      .then(() => {
        refreshPeople()
        /* Only leave the person view if it was this person open in it. */
        if (activePersonId === id) {
          setActivePersonId(null)
          setRoute('people')
        }
      })
      .catch((error) => console.error('[people] archivePerson failed:', error))
  }

  function openPerson(id: string): void {
    setActivePersonId(id)
    setRoute('person')
  }

  function refreshSkills(): void {
    window.api
      .getSkills()
      .then(setSkills)
      .catch((error) => console.error('[skills] getSkills failed:', error))
  }

  function createSkill(): void {
    window.api
      .createSkill('Untitled skill')
      .then((id) => {
        refreshSkills()
        setActiveSkillId(id)
        setRoute('skill')
      })
      .catch((error) => console.error('[skills] createSkill failed:', error))
  }

  function deleteSkill(id: string): void {
    window.api
      .archiveSkill(id)
      .then(() => {
        refreshSkills()
        /* Only leave the skill view if it was this skill open in it. */
        if (activeSkillId === id) {
          setActiveSkillId(null)
          setRoute('skills')
        }
      })
      .catch((error) => console.error('[skills] archiveSkill failed:', error))
  }

  /* Switching sections returns to whatever was last open in the target one, rather than dropping
     back to its list. The ids are already held for the lifetime of the window, so this only decides
     which route a section resolves to — nothing new is stored, and nothing goes to Notion.

     Each is checked against the loaded list first: an item deleted or renamed out from under us
     would otherwise route to a detail view that fetches an id Notion no longer has. */
  function navigate(section: string): void {
    if (section === 'projects') {
      setRoute(activeProjectId && projects.some((p) => p.id === activeProjectId) ? 'project' : 'projects')
      return
    }
    if (section === 'skills') {
      setRoute(activeSkillId && skills.some((sk) => sk.id === activeSkillId) ? 'skill' : 'skills')
      return
    }
    if (section === 'people') {
      setRoute(activePersonId && people.some((p) => p.id === activePersonId) ? 'person' : 'people')
      return
    }
    setRoute(section)
  }

  function openSkill(id: string): void {
    setActiveSkillId(id)
    setRoute('skill')
  }

  async function loadSystemInstruction(): Promise<void> {
    try {
      systemInstruction.current = (await window.api.getConfig()).system.trim()
    } catch (error) {
      console.error('[chat] getConfig failed:', error)
    }
  }

  /* An edited instruction has to reach chats already open, so every cached prompt is dropped and
     rebuilt on the next send rather than being patched in place. */
  async function refreshSystemInstruction(): Promise<void> {
    await loadSystemInstruction()
    const clear = (c: Conversation): Conversation => ({ ...c, systemPrompt: undefined, contextVersions: undefined })
    setConversations((prev) => prev.map(clear))
    setNotionChats((prev) => prev.map(clear))
  }

  function changeExpandTools(value: boolean): void {
    setExpandTools(value)
    saveExpandTools(value)
  }

  function changePollSeconds(value: number): void {
    const next = clampPollSeconds(value)
    setPollSeconds(next)
    savePollSeconds(next)
  }

  const active = allConversations.find((c) => c.id === activeId) ?? null
  const messages = active ? active.messages : []
  const contextProject = contextProjectId ? (projects.find((p) => p.id === contextProjectId) ?? null) : null
  const activeSkill = activeSkillId ? (skills.find((sk) => sk.id === activeSkillId) ?? null) : null

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
      /* Results answer a call that is already on screen, so they update an existing badge rather
         than appending a new part. */
      const results = resultsFromEvent(event)
      if (results.size > 0) attachToolResults(target, results)

      const parts = formatEvent(event)
      if (parts.length > 0) appendParts(target, parts)
    })
  }, [])

  /* Context usage rides in on the same stream, and is tracked per session rather than per streaming
     target: it belongs to the chat the event names, whether or not that chat is the one on screen.
     Each turn overwrites the last — this is how full the window is now, not a running total. */
  useEffect(() => {
    if (!window.api.onClaudeEvent) return
    return window.api.onClaudeEvent(({ sessionId, event }) => {
      const usage = usageFromEvent(event)
      if (usage) setContextTokens((prev) => ({ ...prev, [sessionId]: usage.total }))
    })
  }, [])

  useEffect(() => {
    if (!window.api.onClaudeDebug) return
    return window.api.onClaudeDebug(({ sessionId, line }) => {
      setDebugLogs((prev) => ({ ...prev, [sessionId]: (prev[sessionId] ?? []).concat(line) }))
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

  /** Folds a turn's tool results onto the badges they belong to, matched by `tool_use_id`. */
  function attachToolResults(
    target: { conversationId: number; botId: number; sessionId: string },
    results: Map<string, ToolOutcome>
  ): void {
    const withResults = (parts: MessagePart[]): MessagePart[] =>
      parts.map((p) => {
        const outcome = p.kind === 'tool' && p.id ? results.get(p.id) : undefined
        return outcome ? { ...p, outcome } : p
      })

    streamParts.current = withResults(streamParts.current)
    patch(target.conversationId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === target.botId ? { ...m, parts: withResults(m.parts) } : m))
    }))
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

    /* The meter's reading survives a restart the same way the messages do — off the transcript,
       which records what the API charged for every reply. Without this a reopened chat shows no
       bar at all until it is spoken to again.

       Never overwrites a live reading: this run's own turns are the better number, and the read is
       async, so a reply that lands first must not be undone by the file's older count. */
    void window.api
      .readSessionContextTokens(chat.sessionId)
      .then((total) => {
        if (total === null) return
        setContextTokens((prev) => (chat.sessionId in prev ? prev : { ...prev, [chat.sessionId]: total }))
      })
      .catch((error) => console.error('[chat] readSessionContextTokens failed:', error))
  }

  function createConversation(): number {
    const id = nextConversationId.current++
    /* Minted here rather than scraped off the CLI's `init` event, so the chat has an addressable
       session from the moment it exists and the Notion row is never written without one. */
    const sessionId = crypto.randomUUID()
    sessionIdByConversation.current.set(id, sessionId)
    setConversations((prev) =>
      prev.concat({
        id,
        title: UNTITLED,
        messages: [],
        sessionId,
        model: modelId,
        effort: effortId,
        loaded: true,
        lastActive: new Date().toISOString()
      })
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
    setPendingSkill(null)
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

  /** Archives a project in Notion and drops it from the list. Chats that referenced it keep the
      reference — an id that no longer resolves stops producing a chip, which is what an archived
      project should look like. */
  function deleteProject(id: string): void {
    window.api
      .archiveProject(id)
      .then(() => {
        setProjects((prev) => prev.filter((p) => p.id !== id))
        refreshProjects()
        /* Only leave the project view if it was this project open in it. */
        if (activeProjectId === id) {
          setActiveProjectId(null)
          setRoute('projects')
        }
      })
      .catch((error) => console.error('[projects] archiveProject failed:', error))
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

  /** Persistent skills switched on for a chat, resolved from the ids stored on its Notion row. */
  function activeSkillsFor(names: string[] | undefined): Skill[] {
    if (!names || names.length === 0) return []
    const byName = new Map(skills.filter((sk) => sk.mode === 'persistent').map((sk) => [sk.name, sk]))
    return names.map((n) => byName.get(n)).filter((sk): sk is Skill => Boolean(sk))
  }

  /** Assembles what the CLI's system prompt gets appended for a set of projects. Empty for an empty
      set, which spawns the process with no extra flags at all.

      The stamps are read after the context, not before: a project edited mid-assembly then leaves a
      stamp newer than what was actually fetched, and the next send reassembles. Reading them first
      would record the edit as already included and never pick it up. */
  async function assembleSystemPrompt(attached: Project[], activeSkills: Skill[]): Promise<AssembledContext> {
    const base = systemInstruction.current
    /* Skill bodies are already in hand — they arrived with the skills list — so switching one on
       costs the respawn and nothing else. */
    const skillsPrompt = buildSkillsPrompt(activeSkills)
    const join = (parts: string[]): string => parts.filter((t) => t.trim()).join(SECTION_BREAK)

    if (attached.length === 0) return { systemPrompt: join([base, skillsPrompt]), versions: {} }

    try {
      const contexts = await Promise.all(
        attached.map(async (p) => ({ title: p.title, text: (await window.api.getProjectContext(p.id)).trim() }))
      )
      const versions = await readVersions(attached)
      const projectContext = buildSystemPrompt(contexts.map((c) => ({ label: c.title, text: c.text })))
      return { systemPrompt: join([base, skillsPrompt, projectContext]), versions }
    } catch (error) {
      console.error('[chat] project context assembly failed:', error)
      /* The base instruction and any switched-on skills still apply when the project fetch failed. */
      return { systemPrompt: join([base, skillsPrompt]), versions: {} }
    }
  }

  /** Applies a change to the attached set: rebuilds the context, records it on the chat's Notion row,
      and respawns the CLI so the new system prompt takes effect now rather than on the next send.
      Attaching and detaching both come through here — the system prompt is replaced wholesale, so a
      removal genuinely drops that project's context rather than leaving it behind in the history. */
  function applyAttachment(next: Project[], nextSkillNames?: string[]): void {
    setAttachedProjects(next)

    const conversationId = activeId
    /* Nothing to persist or respawn for a chat that does not exist yet — `send` assembles from the
       staged set when it creates one. */
    if (conversationId === null) return

    const projectIds = next.map((p) => p.id)
    const sessionId = sessionIdByConversation.current.get(conversationId)
    const conversation = conversationsRef.current.find((c) => c.id === conversationId)
    const skillNames = nextSkillNames ?? conversation?.activeSkillNames ?? []

    if (nextSkillNames && sessionId) saveActiveSkills(sessionId, nextSkillNames)

    void (async () => {
      const { systemPrompt, versions } = await assembleSystemPrompt(next, activeSkillsFor(skillNames))
      patch(conversationId, (c) => ({
        ...c,
        referencedProjectRefs: projectIds,
        activeSkillNames: skillNames,
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
        if (sourceId) await window.api.setChatProject(sourceId, projectIds)
      } catch (error) {
        console.error('[chat] setChatProject failed:', error)
      }
    })()
  }

  /** Switching a persistent skill on or off for the active chat. Reuses the attachment path, so the
      system prompt is rebuilt and the process respawned exactly as it is for a project. */
  function toggleSkill(name: string): void {
    const conversationId = activeId
    const current =
      (conversationId !== null
        ? conversationsRef.current.find((c) => c.id === conversationId)?.activeSkillNames
        : undefined) ?? []
    const next = current.includes(name) ? current.filter((n) => n !== name) : current.concat(name)
    applyAttachment(attachedProjects, next)
  }

  function attachProject(id: string): void {
    if (attachedProjects.some((p) => p.id === id)) return
    const project = projects.find((p) => p.id === id)
    if (project) applyAttachment(attachedProjects.concat(project))
  }

  function removeAttachedProject(id: string): void {
    applyAttachment(attachedProjects.filter((p) => p.id !== id))
  }

  /** A chat unlinked from a project over in the project view. Its stored refs are what the sidebar
      tint, the chips and the next send's Notion write all read from, so they have to drop the project
      too — and the cached system prompt with them, so the next send reassembles without its context.

      The title is dropped alongside the id because a row untouched since the switch still holds the
      title, and that is the copy the unlink just removed in Notion. */
  function chatUnlinkedFromProject(chatId: string, projectId: string, projectTitle: string): void {
    const drop = (c: Conversation): Conversation =>
      c.sourceId !== chatId
        ? c
        : {
            ...c,
            referencedProjectRefs: (c.referencedProjectRefs ?? []).filter(
              (ref) => !(isNotionId(ref) ? sameNotionId(ref, projectId) : ref === projectTitle)
            ),
            systemPrompt: undefined,
            contextVersions: undefined
          }

    setConversations((prev) => prev.map(drop))
    setNotionChats((prev) => prev.map(drop))
    if (allConversations.find((c) => c.id === activeId)?.sourceId === chatId) {
      setAttachedProjects((prev) => prev.filter((p) => !sameNotionId(p.id, projectId)))
    }
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
    setRoute('chats')
    /* The pickers follow the chat, so reopening one restores the model and effort it was using. */
    const chat = allConversations.find((c) => c.id === id)
    if (chat) {
      setModelId(chat.model || DEFAULT_MODEL_ID)
      setEffortId(chat.effort || DEFAULT_EFFORT_ID)
      /* The chips are the only place an attachment is shown, so they have to follow the chat too —
         they are its live set, not a staging area for the next message. */
      setAttachedProjects(projectsForRefs(chat.referencedProjectRefs ?? []))
      /* Skills are stored per session rather than on the conversation, so they are read back here
         rather than arriving with the chat log. */
      const active = loadActiveSkills(chat.sessionId)
      patch(chat.id, (c) => ({ ...c, activeSkillNames: active }))
      setPendingSkill(null)
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
    const projectIdsForNotion = attachedProjects.map((p) => p.id)

    /* A one-shot skill is resolved here, not by the model: its body is already loaded, so the turn
       goes out with the instructions in it and no round trip in between. Only the user's own text is
       shown in the bubble — the body is recovered from the transcript the same way, and dropped. */
    const skill = pendingSkill
    const userParts: MessagePart[] = textPart(text)
    const sendText = skill ? renderSkillInvocation(skill.name, skill.body, text) : text

    const activeSkills = activeSkillsFor(conv?.activeSkillNames)

    /* Reassemble when the cache is missing (a reopened chat) or when any attached project has been
       edited since it was built — in Notion, or by another chat that this project has attached. The
       stamp costs three API calls against the context's three-plus-N, so checking every send is
       cheaper than being wrong. */
    let systemPrompt = conv?.systemPrompt ?? ''
    let contextVersions = conv?.contextVersions
    if (conv?.systemPrompt === undefined) {
      ({ systemPrompt, versions: contextVersions } = await assembleSystemPrompt(attachedProjects, activeSkills))
    } else if (attachedProjects.length > 0) {
      const fresh = await readVersions(attachedProjects).catch((error) => {
        console.error('[chat] project version check failed:', error)
        return null
      })
      /* A failed check leaves the cache alone: sending stale context beats dropping it. */
      if (fresh && attachedProjects.some((p) => fresh[p.id] !== contextVersions?.[p.id])) {
        ({ systemPrompt, versions: contextVersions } = await assembleSystemPrompt(attachedProjects, activeSkills))
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
      referencedProjectRefs: projectIdsForNotion,
      systemPrompt,
      contextVersions,
      /* Mirrors the `updateLastActive` write below, so the label moves the moment the message is
         sent rather than waiting for the next read of the chat log. */
      lastActive: new Date().toISOString()
    }))
    setDraft('')
    /* One-shot means one turn: it is spent the moment it is sent. */
    setPendingSkill(null)
    setStreamingId(conversationId)

    /* Re-title the chat from every user message it now contains — runs on its own isolated
       haiku call, independent of the main conversation, and never blocks sending the prompt.
       The instruction itself is the `title` field of the Config page's JSON block (Settings >
       Injection > Title) — no title refresh happens until that field has text. */
    async function refreshTitle(): Promise<void> {
      try {
        const instruction = (await window.api.getConfig()).title.trim()
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
      if (projectIdsForNotion.length > 0) await window.api.setChatProject(sourceId, projectIdsForNotion)
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

  /** Renders a message's parts. */
  function renderParts(parts: MessagePart[]): ReactElement[] {
    const rendered: ReactElement[] = []
    let i = 0
    while (i < parts.length) {
      const part = parts[i]

      /* Consecutive calls to the same tool are one run, named once rather than repeating the
         header per call. A different tool starts a new group. */
      if (part.kind === 'tool') {
        const group: ToolPart[] = []
        const start = i
        while (i < parts.length) {
          const next = parts[i]
          if (next.kind !== 'tool' || next.name !== part.name) break
          group.push(next)
          i++
        }
        const replyNext = i < parts.length && parts[i].kind === 'text'
        rendered.push(
          <ToolGroup
            key={start}
            name={part.name}
            parts={group}
            defaultOpen={expandTools}
            gapAfter={replyNext ? REPLY_GAP : GROUP_GAP}
          />
        )
        continue
      }

      rendered.push(<span key={i}>{part.text}</span>)
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
      {settingsOpen ? (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onSystemPromptSaved={() => void refreshSystemInstruction()}
          expandTools={expandTools}
          onExpandToolsChange={changeExpandTools}
          pollSeconds={pollSeconds}
          onPollSecondsChange={changePollSeconds}
        />
      ) : null}
      {contextProject ? (
        <ProjectContextModal
          projectId={contextProject.id}
          title={contextProject.title}
          onClose={() => setContextProjectId(null)}
        />
      ) : null}
      {showPendingSkill && pendingSkill ? (
        <InjectionModal
          title={pendingSkill.name}
          subtitle="Sent with the next message"
          onClose={() => setShowPendingSkill(false)}
        >
          {pendingSkill.body.trim() || 'This skill is empty — nothing is sent for it.'}
        </InjectionModal>
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
                projects: projectsForRefs(c.referencedProjectRefs ?? []),
                status: sessionStatuses[c.sessionId] ?? 'idle',
                lastActive: c.lastActive
              }))}
              activeId={activeId}
              onSelect={selectConversation}
              onNew={startNewChat}
              onDelete={deleteConversation}
              projects={projects}
              activeProjectId={activeProjectId}
              onSelectProject={openProject}
              onDeleteProject={deleteProject}
              skills={skills.map((sk) => ({ id: sk.id, name: sk.name, mode: sk.mode }))}
              activeSkillId={activeSkillId}
              onSelectSkill={openSkill}
              onNewSkill={createSkill}
              onDeleteSkill={deleteSkill}
              people={people}
              activePersonId={activePersonId}
              onSelectPerson={openPerson}
              onNewPerson={createPerson}
              onDeletePerson={deletePerson}
              onNewProject={newProject}
              route={route}
              onNavigate={navigate}
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
          {route === 'people' || (route === 'person' && !activePersonId) ? (
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
                Select a person from the sidebar, or add a new one.
              </span>
            </div>
          ) : route === 'person' && activePersonId ? (
            <PersonDetailView
              personId={activePersonId}
              fallbackName={people.find((p) => p.id === activePersonId)?.name ?? ''}
              onBack={() => setRoute('people')}
              onSaved={refreshPeople}
            />
          ) : route === 'skills' || (route === 'skill' && !activeSkillId) ? (
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
                Select a skill from the sidebar, or write a new one.
              </span>
            </div>
          ) : route === 'skill' && activeSkillId ? (
            <SkillDetailView
              skillId={activeSkillId}
              fallbackName={activeSkill?.name ?? ''}
              onBack={() => setRoute('skills')}
              onSaved={refreshSkills}
            />
          ) : route === 'projects' ? (
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
            onOpenPerson={openPerson}
            onChatUnlinked={chatUnlinkedFromProject}
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
        {active ? (
          <IconButton
            icon="terminal"
            label="Show what's sent to the CLI"
            size="md"
            glyphSize={19}
            active={debugOpen}
            onClick={() => setDebugOpen((v) => !v)}
            style={{
              position: 'absolute',
              top: 22,
              right: 28,
              zIndex: 20,
              pointerEvents: 'auto',
              color: '#E2E1DE'
            }}
          />
        ) : null}
        {debugOpen && active ? (
          <div
            className="chatscroll"
            style={{
              position: 'absolute',
              top: 56,
              right: 28,
              width: 480,
              maxHeight: '60%',
              overflowY: 'auto',
              background: '#111110',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: '10px 12px',
              zIndex: 10,
              font: 'var(--weight-regular) var(--text-sm)/1.5 var(--font-mono)',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              color: '#B7B6B2'
            }}
          >
            {(debugLogs[active.sessionId] ?? []).length > 0 ? (
              (debugLogs[active.sessionId] ?? []).map((line, i) => (
                <div key={i} style={{ marginBottom: '8px' }}>
                  {line}
                </div>
              ))
            ) : (
              <span style={{ color: 'var(--text-faint)' }}>Nothing sent to the CLI yet.</span>
            )}
          </div>
        ) : null}
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
                        {streamingHere && last && m.id === last.id ? <Thinking /> : null}
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
            skills={skills.map((sk) => ({ id: sk.id, name: sk.name, mode: sk.mode }))}
            activeSkillNames={active?.activeSkillNames ?? []}
            onToggleSkill={toggleSkill}
            pendingSkillName={pendingSkill?.name ?? null}
            onInvokeSkill={(id) => setPendingSkill(skills.find((sk) => sk.id === id) ?? null)}
            onClearPendingSkill={() => setPendingSkill(null)}
            onOpenPendingSkill={() => setShowPendingSkill(true)}
            contextTokens={active ? (contextTokens[active.sessionId] ?? null) : null}
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
