import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, ReactElement } from 'react'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton, SkeletonLines } from '@/components/ui/skeleton'
import { blocksToMarkdown } from '@shared/markdown'

/* Implementation of `Project Detail.dc.html` from the Claude app design system —
   the drill-down from a ProjectsView card.

   The design's panels map onto what a Notion project page actually holds:
     Recents      -> the page's child pages (one per conversation)
     Instructions -> the content of a dedicated "Instructions" child page, if one exists
   Context has no backing data yet, so it renders the design's empty state. */

interface DetailBlock {
  id: string
  type: string
  text: string
  checked?: boolean
  url?: string
}

interface ProjectChatEntry {
  id: string
  name: string
}

interface ProjectDetail {
  id: string
  title: string
  lastEdited: string | null
  instructions: string
  color: string | null
  blocks: DetailBlock[]
  chats: ProjectChatEntry[]
  people: PersonEntry[]
}

interface PersonEntry {
  id: string
  name: string
}

/* Panel shell: 16px inset, hairline divider on every section but the last. */
function panelStyle(last = false): CSSProperties {
  return { padding: 'var(--space-7)', borderBottom: last ? 'none' : '1px solid var(--border-default)' }
}

const headingStyle: CSSProperties = {
  margin: 0,
  font: 'var(--type-body-strong)',
  color: 'var(--text-primary)',
  letterSpacing: 'var(--tracking-tight)'
}

const panelBodyStyle: CSSProperties = {
  margin: 0,
  font: 'var(--type-body)',
  color: 'var(--text-muted)',
  letterSpacing: 'var(--tracking-tight)'
}

/* Context — inner pages as small cards. */

/** Optical sizing for the badge glyphs: drawn on the same 24px grid, they carry different amounts
    of internal margin, so one nominal size renders three different-looking icons. Notion's mark and
    the person both sit small inside their box and are pushed up to match the chat bubble. */
const BADGE_ICON_SIZE: Record<string, number> = { notion: 20, user: 20 }
const DEFAULT_BADGE_ICON_SIZE = 16


function ContextCard({
  title,
  badge,
  onOpen,
  onRemove,
  removeLabel
}: {
  title: string
  /** Icon name for the card's kind: a Notion page, a chat, or a person. */
  badge: string
  onOpen: () => void
  onRemove: () => void
  removeLabel: string
}): ReactElement {
  const [hover, setHover] = useState(false)
  const [focusRemove, setFocusRemove] = useState(false)
  const [hoverRemove, setHoverRemove] = useState(false)
  const showRemove = hover || focusRemove

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        /* The remove button lives inside the card, so its own Enter would bubble up to here and open
           what it just removed. */
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: 125,
        padding: '13px 14px 12px',
        boxSizing: 'border-box',
        background: hover ? '#282826' : '#212120',
        border: `1px solid ${hover ? '#3a3a38' : '#2b2b29'}`,
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'var(--transition-control)'
      }}
    >
      {/* Sits on the corner rather than inside it, so it never crowds a long title. Kept mounted
          while hidden so it can be reached by keyboard, and click-through is blocked with
          `pointerEvents` for as long as it is invisible. */}
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        onFocus={() => setFocusRemove(true)}
        onBlur={() => setFocusRemove(false)}
        onMouseEnter={() => setHoverRemove(true)}
        onMouseLeave={() => setHoverRemove(false)}
        style={{
          position: 'absolute',
          top: -10,
          right: -10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 24,
          padding: 0,
          background: hoverRemove ? '#3a3a38' : '#2e2e2c',
          border: '1px solid #3f3f3c',
          borderRadius: '50%',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          opacity: showRemove ? 1 : 0,
          pointerEvents: showRemove ? 'auto' : 'none',
          transition: 'var(--transition-control)'
        }}
      >
        <Icon name="x" size={14} style={{ opacity: hoverRemove ? 1 : 0.7 }} />
      </button>
      <span
        style={{
          font: 'var(--weight-semibold) 13px/1.35 var(--font-sans)',
          color: 'var(--text-primary)',
          letterSpacing: 'var(--tracking-tight)',
          wordBreak: 'break-word'
        }}
      >
        {title}
      </span>
      <span style={{ flex: '1 1 auto' }} />
      {/* The kind, as the same glyph its section uses in the sidebar, so a card is recognised
          without reading it. Square rather than the old text pill: with the word gone there is
          nothing to set the width. */}
      <span
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          background: '#2e2e2c',
          border: '1px solid #3a3a38',
          borderRadius: 5,
          color: 'var(--text-body)'
        }}
      >
        <Icon name={badge} size={BADGE_ICON_SIZE[badge] ?? DEFAULT_BADGE_ICON_SIZE} />
      </span>
    </div>
  )
}

/** The "add context" menu: pick what kind of thing to attach, then which one.

    Two levels rather than one flat list, because the three kinds behave differently — a chat and a
    person are picked from what already exists, while "New" creates a page here and now. */
function AddContextMenu({
  chats,
  people,
  onAttachChat,
  onAttachPerson,
  onNew,
  onClose,
  anchor
}: {
  chats: Array<{ id: string; name: string }>
  people: Array<{ id: string; name: string }>
  onAttachChat: (id: string) => void
  onAttachPerson: (id: string) => void
  onNew: () => void
  onClose: () => void
  /** Where the button sits on screen. The menu is portalled to the body and positioned from this,
      because the panel it lives in clips its own overflow to keep its rounded corners. */
  anchor: DOMRect
}): ReactElement {
  const [kind, setKind] = useState<'chat' | 'person' | null>(null)

  const list = kind === 'chat' ? chats : people
  const panelStyle: CSSProperties = {
    zIndex: 61,
    padding: 'var(--space-2)',
    boxSizing: 'border-box',
    background: '#20201F',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
  }

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 60 }} onClick={onClose} />
      {/* No close-on-leave: the flyout stays up once opened, and is dismissed by hovering back onto
          a row of this menu that has no list of its own, or by picking something. Closing it when
          the pointer left would take it away while it was being reached for. */}
      <div
        style={{
          ...panelStyle,
          position: 'fixed',
          top: anchor.bottom + 4,
          right: Math.max(8, window.innerWidth - anchor.right),
          minWidth: 140
        }}
      >
        <MenuItem
          label="Chat"
          trailing="chevron-right"
          active={kind === 'chat'}
          onHover={() => setKind('chat')}
          onClick={() => setKind('chat')}
        />
        <MenuItem
          label="Person"
          trailing="chevron-right"
          active={kind === 'person'}
          onHover={() => setKind('person')}
          onClick={() => setKind('person')}
        />
        {/* Hovering a row with no list of its own closes whichever one is open, so the flyout tracks
            the pointer rather than lingering over an unrelated row. */}
        <MenuItem label="New" onHover={() => setKind(null)} onClick={onNew} />

        {/* Alongside rather than replacing, the way the effort menu sits beside the model menu — the
            kind stays visible while its list is being read. */}
        {kind ? (
          /* The 12px separation is this wrapper's padding rather than an offset, so crossing it
             keeps the pointer inside the menu and the flyout does not flicker shut on the way. */
          <div style={{ position: 'absolute', left: '100%', top: 0, paddingLeft: 12 }}>
          {/* Deliberately not `chatscroll`: its stable scrollbar gutter insets both edges by 10px,
              which would leave this panel padded differently from the one it hangs off. */}
          <div style={{ ...panelStyle, minWidth: 200, maxHeight: 260, overflowY: 'auto' }}>
            {list.length === 0 ? (
              <div
                style={{
                  padding: '4px 8px',
                  font: 'var(--type-meta)',
                  letterSpacing: 'var(--tracking-tight)',
                  color: 'var(--text-faint)',
                  whiteSpace: 'nowrap'
                }}
              >
                {kind === 'chat' ? 'No other chats' : 'No people yet'}
              </div>
            ) : (
              list.map((entry) => (
                <MenuItem
                  key={entry.id}
                  label={entry.name || 'Untitled'}
                  onClick={() => (kind === 'chat' ? onAttachChat(entry.id) : onAttachPerson(entry.id))}
                />
              ))
            )}
          </div>
          </div>
        ) : null}
      </div>
    </>,
    document.body
  )
}

/** One row of the add-context menu, styled after the chat row's options menu in the sidebar. */
function MenuItem({
  label,
  trailing,
  active,
  onHover,
  onClick
}: {
  label: string
  /** A chevron on the rows that open a list beside the menu. */
  trailing?: string
  active?: boolean
  /** Rows that open a list do it on hover; the click is kept so the row still works from a keyboard
      or a tap, where there is no hover to speak of. */
  onHover?: () => void
  onClick: () => void
}): ReactElement {
  const background = active ? 'var(--surface-hover)' : 'transparent'

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'left',
        padding: '4px 8px',
        background,
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: '#E6E5E2',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base)',
        fontWeight: 'var(--weight-regular)',
        lineHeight: 'var(--leading-normal)',
        letterSpacing: 'var(--tracking-tight)',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
      onFocus={onHover}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-hover)'
        onHover?.()
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = background)}
    >
      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {trailing ? (
        <span style={{ display: 'inline-flex', flex: '0 0 auto', color: 'var(--text-faint)' }}>
          <Icon name={trailing} size={14} />
        </span>
      ) : null}
    </button>
  )
}

interface ContextCardItem {
  id: string
  title: string
  /** Icon name for the card's kind — see `ContextCard`. */
  badge: string
  onOpen: () => void
  onRemove: () => void
  removeLabel: string
}

/** Stand-in for the context grid: cards at the same 152x125 the real ones use, so the panel keeps
    its height and nothing below it jumps. */
function ContextCardsSkeleton(): ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, 152px)',
        justifyContent: 'start',
        gap: 12
      }}
    >
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} height={125} radius={8} delay={i * 0.12} />
      ))}
    </div>
  )
}

function ContextCards({ items }: { items: ContextCardItem[] }): ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, 152px)',
        justifyContent: 'start',
        gap: 12
      }}
    >
      {items.map((item) => (
        <ContextCard
          key={item.id}
          title={item.title}
          badge={item.badge}
          onOpen={item.onOpen}
          onRemove={item.onRemove}
          removeLabel={item.removeLabel}
        />
      ))}
    </div>
  )
}

/* The Context empty state: three stacked paper cards, the front one badged with a +. */
function ContextPlaceholder(): ReactElement {
  const line = (width: string, opacity: number): ReactElement => (
    <div style={{ height: 1, width, background: 'var(--bone-500)', opacity }} />
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-9)',
        padding: '34px 28px',
        /* One notch below the sidebar plate — no token for this well. */
        background: '#141413',
        borderRadius: 'var(--radius-md)'
      }}
    >
      <div style={{ position: 'relative', width: 118, height: 52 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 2,
            width: 34,
            height: 24,
            padding: 5,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            background: 'var(--surface-control)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            transform: 'rotate(-4deg)'
          }}
        >
          {line('100%', 0.5)}
          {line('70%', 0.5)}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 60,
            top: 0,
            width: 38,
            height: 44,
            padding: 6,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            background: 'var(--surface-control)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            transform: 'rotate(5deg)'
          }}
        >
          {line('100%', 0.5)}
          {line('100%', 0.5)}
          {line('60%', 0.5)}
          {line('100%', 0.5)}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 30,
            bottom: 0,
            width: 40,
            height: 32,
            padding: 6,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            background: 'var(--surface-thumb)',
            border: '1px solid var(--border-inset)',
            borderRadius: 4
          }}
        >
          {line('100%', 0.6)}
          {line('65%', 0.6)}
          <div
            style={{
              position: 'absolute',
              right: -6,
              bottom: -6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              background: 'var(--surface-thumb)',
              border: '1px solid var(--border-inset)',
              borderRadius: '50%',
              color: 'var(--text-body)',
              font: 'var(--weight-medium) 11px/1 var(--font-sans)'
            }}
          >
            +
          </div>
        </div>
      </div>
      <p style={{ ...panelBodyStyle, maxWidth: 220, textAlign: 'center' }}>
        Add PDFs, documents, or other text to reference in this project.
      </p>
    </div>
  )
}

const BLOCK_TAG: Record<string, string | undefined> = {
  heading_1: 'h3',
  heading_2: 'h4',
  heading_3: 'h4',
  bulleted_list_item: 'li',
  numbered_list_item: 'li',
  to_do: 'li'
}

/** Flattens a page's text blocks down to plain lines — the shape an edit textarea round-trips through. */

/** Shared by the name field and the colour swatch, so the two halves sit level. */
const FIELD_HEIGHT = 42

/** A single-line editable field, matching the textarea below it. */
const editFieldStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0 var(--space-5)',
  background: 'var(--surface-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-body)',
  font: 'var(--type-body)',
  letterSpacing: 'var(--tracking-tight)',
  outline: 'none',
  boxShadow: 'none'
}

const editTextareaStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 120,
  padding: 'var(--space-5)',
  resize: 'vertical',
  background: 'var(--surface-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-body)',
  font: 'var(--type-body)',
  letterSpacing: 'var(--tracking-tight)',
  outline: 'none',
  boxShadow: 'none'
}

/* Full-page context view — replaces the project overview, in place of a modal. */
function ContextPageView({
  projectTitle,
  detail,
  loading,
  error,
  onBackToProjects,
  onBackToProject,
  onSave
}: {
  projectTitle: string
  detail: ProjectDetail | null
  loading: boolean
  error: boolean
  onBackToProjects: () => void
  onBackToProject: () => void
  onSave: (text: string) => Promise<void>
}): ReactElement {
  const blocks = detail?.blocks.filter((b) => b.type !== 'child_page') ?? []
  const title = detail?.title || 'Untitled'

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  /* Markdown, so a heading edited here is written back as a heading rather than being flattened to
     a paragraph on save. Images and child pages have no spelling and are left out — they are not
     prose, and round-tripping them through a textarea would delete them. */
  const original = blocksToMarkdown(blocks.filter((b) => b.type !== 'child_page' && b.type !== 'image'))
  const dirty = draft !== original

  function startEditing(): void {
    setDraft(original)
    setEditing(true)
  }

  async function sync(): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (err) {
      console.error('[project] updateContextPageContent failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-app)',
        borderTopLeftRadius: 'var(--radius-xl)',
        overflow: 'hidden'
      }}
    >
      <nav
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: '24px 28px 0',
          font: 'var(--weight-semibold) var(--text-sm)/1 var(--font-sans)',
          letterSpacing: 'var(--tracking-tight)'
        }}
      >
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onBackToProjects()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          Projects
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onBackToProject()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          {projectTitle}
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{title}</span>
      </nav>

      <div
        className="chatscroll"
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
      <div
        style={{
          width: '100%',
          maxWidth: 1114,
          margin: '0 auto',
          padding: '38px 28px 64px',
          boxSizing: 'border-box'
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-10)',
            marginBottom: 'var(--space-10)'
          }}
        >
          <h1
            style={{
              margin: 0,
              font: 'var(--type-title)',
              color: 'var(--text-primary)',
              letterSpacing: 'var(--tracking-display)'
            }}
          >
            {title}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flex: '0 0 auto', paddingTop: 4 }}>
            {editing && dirty ? (
              <IconButton icon="refresh-cw" label="Sync to Notion" size="sm" onClick={() => void sync()} disabled={saving} />
            ) : null}
            <IconButton
              icon="pencil"
              label={editing ? 'Cancel edit' : 'Edit page'}
              size="sm"
              active={editing}
              onClick={() => (editing ? setEditing(false) : startEditing())}
            />
          </div>
        </header>

        {editing ? (
          <textarea
            className="chatscroll"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={editTextareaStyle}
            autoFocus
          />
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {loading ? (
            <span style={panelBodyStyle}>Loading…</span>
          ) : error ? (
            <span style={panelBodyStyle}>Couldn&apos;t load this page.</span>
          ) : blocks.length === 0 ? (
            <span style={panelBodyStyle}>This page is empty.</span>
          ) : (
            blocks.map((b) => {
              if (b.type === 'image' && b.url) {
                return (
                  <img
                    key={b.id}
                    src={b.url}
                    alt={b.text || ''}
                    style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)', display: 'block' }}
                  />
                )
              }
              const tag = BLOCK_TAG[b.type]
              const text = b.type === 'to_do' ? `${b.checked ? '☑' : '☐'} ${b.text}` : b.text
              if (tag === 'h3' || tag === 'h4') {
                return (
                  <h3 key={b.id} style={{ ...headingStyle, margin: 0 }}>
                    {text}
                  </h3>
                )
              }
              if (tag === 'li') {
                return (
                  <p key={b.id} style={{ ...panelBodyStyle, margin: 0, paddingLeft: 'var(--space-6)' }}>
                    {text}
                  </p>
                )
              }
              return (
                <p key={b.id} style={{ ...panelBodyStyle, margin: 0 }}>
                  {text}
                </p>
              )
            })
          )}
        </div>
        )}
      </div>
      </div>
    </main>
  )
}

const titleInputStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '4px 0',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border-default)',
  outline: 'none',
  boxShadow: 'none',
  color: 'var(--text-primary)',
  font: 'var(--type-title)',
  letterSpacing: 'var(--tracking-display)'
}

/** Full-page "new context" view — an empty page the user titles and writes before it exists in Notion. */
function NewContextPageView({
  projectTitle,
  onBackToProjects,
  onBackToProject,
  onCreate
}: {
  projectTitle: string
  onBackToProjects: () => void
  onBackToProject: () => void
  onCreate: (title: string, text: string) => Promise<void>
}): ReactElement {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  async function sync(): Promise<void> {
    if (saving || !title.trim()) return
    setSaving(true)
    try {
      await onCreate(title.trim(), text)
    } catch (err) {
      console.error('[project] createContextPage failed:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-app)',
        borderTopLeftRadius: 'var(--radius-xl)',
        overflow: 'hidden'
      }}
    >
      <nav
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: '24px 28px 0',
          font: 'var(--weight-semibold) var(--text-sm)/1 var(--font-sans)',
          letterSpacing: 'var(--tracking-tight)'
        }}
      >
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onBackToProjects()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          Projects
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onBackToProject()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          {projectTitle}
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{title || 'Untitled'}</span>
      </nav>

      <div
        className="chatscroll"
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
      <div
        style={{
          width: '100%',
          maxWidth: 1114,
          margin: '0 auto',
          padding: '38px 28px 64px',
          boxSizing: 'border-box'
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-10)',
            marginBottom: 'var(--space-10)'
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
            style={titleInputStyle}
            autoFocus
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flex: '0 0 auto' }}>
            <IconButton
              icon="refresh-cw"
              label="Sync to Notion"
              size="sm"
              onClick={() => void sync()}
              disabled={saving || !title.trim()}
            />
          </div>
        </header>

        <textarea
          className="chatscroll"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write the content for this page…"
          style={editTextareaStyle}
        />
      </div>
      </div>
    </main>
  )
}

export interface ProjectDetailViewProps {
  projectId: string
  /** Opens a person attached to this project, over in the People section. */
  onOpenPerson?: (personId: string) => void
  onBack: () => void
  onColorChange?: (projectId: string, color: string) => void
  onOpenChat: (chatId: string) => void
  /** A chat that just lost this project's tag — the chat list holds its own copy of those refs. Both
      the id and the title go out, since a row untouched since the app moved off titles holds the
      title rather than the id. */
  onChatUnlinked?: (chatId: string, projectId: string, projectTitle: string) => void
}

const DEFAULT_COLOR = '#151515'

export default function ProjectDetailView({
  projectId,
  onBack,
  onColorChange,
  onOpenChat,
  onOpenPerson,
  onChatUnlinked
}: ProjectDetailViewProps): ReactElement {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [openContextId, setOpenContextId] = useState<string | null>(null)
  const [creatingContext, setCreatingContext] = useState(false)
  /* The button's position on screen, captured when the menu opens: the menu is portalled out of
     the panel (which clips its overflow) and so has to be placed from real coordinates. */
  const [addAnchor, setAddAnchor] = useState<DOMRect | null>(null)
  const addButtonRef = useRef<HTMLDivElement | null>(null)
  /* Everything attachable, loaded when the menu is first opened rather than with the project — the
     lists are only ever seen from inside the menu. */
  const [allChats, setAllChats] = useState<Array<{ id: string; name: string }>>([])
  const [allPeople, setAllPeople] = useState<Array<{ id: string; name: string }>>([])
  const [contextDetail, setContextDetail] = useState<ProjectDetail | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState(false)
  /* Name, colour and instructions are edited in place and written together by one Sync, the way a
     skill is. Context is not part of it: attaching a chat or a person writes straight through. */
  const [nameDraft, setNameDraft] = useState('')
  const [instructionsDraft, setInstructionsDraft] = useState('')
  const [colorDraft, setColorDraft] = useState('')
  const [saving, setSaving] = useState(false)

  function loadContext(id: string): void {
    setContextLoading(true)
    setContextError(false)
    window.api
      .getProjectDetail(id)
      .then((d) => setContextDetail(d))
      .catch((err) => {
        console.error('[project] getProjectDetail (context) failed:', err)
        setContextError(true)
      })
      .finally(() => setContextLoading(false))
  }

  useEffect(() => {
    if (!openContextId) return
    setContextDetail(null)
    loadContext(openContextId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openContextId])

  function load(): void {
    setLoading(true)
    setError(false)
    window.api
      .getProjectDetail(projectId)
      .then((d) => {
        setDetail(d)
        setNameDraft(d.title)
        setColorDraft(d.color ?? DEFAULT_COLOR)
        setInstructionsDraft(d.instructions)
      })
      .catch((err) => {
        console.error('[project] getProjectDetail failed:', err)
        setError(true)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  /** Writes whichever of the three changed. Each is a separate Notion call, so only the fields that
      moved are touched — a colour tweak does not rewrite the instructions. */
  async function save(): Promise<void> {
    if (saving || !detail || !dirty) return
    setSaving(true)
    try {
      if (nameDraft !== detail.title) await window.api.updateProjectTitle(projectId, nameDraft)
      if (colorDraft !== (detail.color ?? DEFAULT_COLOR)) {
        await window.api.updateProjectColor(projectId, colorDraft)
        onColorChange?.(projectId, colorDraft)
      }
      if (instructionsDraft !== detail.instructions) {
        await window.api.updateProjectInstructions(projectId, instructionsDraft)
      }
      setDetail((d) => (d ? { ...d, title: nameDraft, color: colorDraft, instructions: instructionsDraft } : d))
    } catch (err) {
      console.error('[project] save failed:', err)
      load()
    } finally {
      setSaving(false)
    }
  }

  /** Throws the unsynced edits away, back to what Notion last gave us. */
  function discard(): void {
    if (!detail) return
    setNameDraft(detail.title)
    setColorDraft(detail.color ?? DEFAULT_COLOR)
    setInstructionsDraft(detail.instructions)
  }

  /* Both removals drop the card first and only reload if Notion refused the write — the panel
     re-reads the whole project, so waiting on the round trip would leave the card sitting there. */
  async function removeContextPage(id: string): Promise<void> {
    setDetail((d) => (d ? { ...d, blocks: d.blocks.filter((b) => b.id !== id) } : d))
    try {
      await window.api.deleteContextPage(id)
    } catch (err) {
      console.error('[project] deleteContextPage failed:', err)
      load()
    }
  }

  /** Pulls the lists the add-menu offers. Called when the menu opens rather than with the project,
      so browsing a project costs nothing extra. */
  function loadAttachable(): void {
    window.api
      .getChatLog()
      .then((rows) => setAllChats(rows.map((row) => ({ id: row.id, name: row.name }))))
      .catch((err) => console.error('[project] getChatLog failed:', err))

    window.api
      .getPeople()
      .then(setAllPeople)
      .catch((err) => console.error('[project] getPeople failed:', err))
  }

  /** Tags the chat's row with this project, which is where that link lives. */
  async function attachChat(chatId: string): Promise<void> {
    if (!detail) return
    try {
      await window.api.linkChatToProject(chatId, projectId, detail.title)
      load()
    } catch (err) {
      console.error('[project] linkChatToProject failed:', err)
    }
  }

  /** People are recorded on the project rather than on the person: a person page has no properties
      to hang a back-reference from, and the attachment is the project's. */
  async function attachPerson(personId: string): Promise<void> {
    if (!detail) return
    const next = detail.people.map((p) => p.id)
    if (next.includes(personId)) return

    try {
      await window.api.updateProjectPeople(projectId, next.concat(personId))
      load()
    } catch (err) {
      console.error('[project] updateProjectPeople failed:', err)
    }
  }

  async function detachPerson(personId: string): Promise<void> {
    if (!detail) return
    setDetail((d) => (d ? { ...d, people: d.people.filter((p) => p.id !== personId) } : d))
    try {
      await window.api.updateProjectPeople(
        projectId,
        detail.people.filter((p) => p.id !== personId).map((p) => p.id)
      )
    } catch (err) {
      console.error('[project] updateProjectPeople failed:', err)
      load()
    }
  }

  /** Unlinks instead of deleting: the chat keeps its row in the Chat Log and loses only this
      project's tag, so it stays reachable from the sidebar. */
  async function unlinkChat(id: string): Promise<void> {
    const projectTitle = detail?.title
    if (!projectTitle) return

    setDetail((d) => (d ? { ...d, chats: d.chats.filter((c) => c.id !== id) } : d))
    try {
      await window.api.unlinkChatFromProject(id, projectId, projectTitle)
      onChatUnlinked?.(id, projectId, projectTitle)
    } catch (err) {
      console.error('[project] unlinkChatFromProject failed:', err)
      load()
    }
  }

  const blocks = detail?.blocks ?? []
  const recents = blocks.filter((b) => b.type === 'child_page')
  const chats = detail?.chats ?? []
  const people = detail?.people ?? []
  /* Already-attached things are dropped from the menu: attaching one twice does nothing, and an
     option that does nothing should not be offered. */
  const attachableChats = allChats.filter((c) => !chats.some((attached) => attached.id === c.id))
  const attachablePeople = allPeople.filter((p) => !people.some((attached) => attached.id === p.id))

  const contextItems: ContextCardItem[] = recents
    .map((p) => ({
      id: p.id,
      title: p.text || 'Untitled',
      badge: 'notion',
      onOpen: () => setOpenContextId(p.id),
      onRemove: () => void removeContextPage(p.id),
      removeLabel: 'Delete page from Notion'
    }))
    .concat(
      chats.map((c) => ({
        id: c.id,
        title: c.name || 'Untitled',
        badge: 'message-circle',
        onOpen: () => onOpenChat(c.id),
        onRemove: () => void unlinkChat(c.id),
        removeLabel: 'Remove chat from this project'
      }))
    )
    .concat(
      people.map((person) => ({
        id: person.id,
        title: person.name || 'Untitled',
        badge: 'user',
        onOpen: () => onOpenPerson?.(person.id),
        onRemove: () => void detachPerson(person.id),
        removeLabel: 'Remove person from this project'
      }))
    )
  const color = colorDraft || DEFAULT_COLOR
  const dirty =
    detail !== null &&
    !loading &&
    (nameDraft !== detail.title ||
      colorDraft !== (detail.color ?? DEFAULT_COLOR) ||
      instructionsDraft !== detail.instructions)

  const title = detail?.title || 'Untitled'
  const emptyStyle: CSSProperties = {
    font: 'var(--type-body)',
    color: 'var(--text-faint)',
    letterSpacing: 'var(--tracking-tight)'
  }

  if (creatingContext) {
    return (
      <NewContextPageView
        projectTitle={title}
        onBackToProjects={onBack}
        onBackToProject={() => setCreatingContext(false)}
        onCreate={async (newTitle, text) => {
          const id = await window.api.createContextPage(projectId, newTitle, text)
          load()
          setCreatingContext(false)
          setOpenContextId(id)
        }}
      />
    )
  }

  if (openContextId) {
    return (
      <ContextPageView
        projectTitle={title}
        detail={contextDetail}
        loading={contextLoading}
        error={contextError}
        onBackToProjects={onBack}
        onBackToProject={() => setOpenContextId(null)}
        onSave={async (text) => {
          await window.api.updateContextPageContent(openContextId, text)
          loadContext(openContextId)
        }}
      />
    )
  }

  return (
    <main
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-app)',
        borderTopLeftRadius: 'var(--radius-xl)',
        overflow: 'hidden'
      }}
    >
      <nav
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: '24px 28px 0',
          font: 'var(--weight-semibold) var(--text-sm)/1 var(--font-sans)',
          letterSpacing: 'var(--tracking-tight)'
        }}
      >
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onBack()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          Projects
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        {loading ? (
          <Skeleton height={13} width={96} />
        ) : (
          <span style={{ color: 'var(--text-primary)' }}>{title}</span>
        )}
      </nav>

      <div
        className="chatscroll"
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
      <div
        style={{
          width: '100%',
          maxWidth: 1114,
          margin: '0 auto',
          padding: '38px 28px 64px',
          boxSizing: 'border-box'
        }}
      >
        {/* The panels are the whole page now that the composer is gone, capped at the width the
            composer column used to have so the context grid fits a few cards per row. The title
            rides the same column so the two stay flush with each other. */}
        <div style={{ width: '100%', maxWidth: 720, margin: '0 auto' }}>
          {/* Title centred in the column, with the actions pinned to the right rather than sharing a
              flex row — a space-between row would shift the title sideways as buttons appear. */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 44,
              margin: '0 0 var(--space-10)'
            }}
          >
            {loading ? (
              <Skeleton height={38} width="42%" />
            ) : (
              <h1
                style={{
                  margin: 0,
                  font: 'var(--type-display)',
                  color: 'var(--text-primary)',
                  letterSpacing: 'var(--tracking-display)',
                  textAlign: 'center'
                }}
              >
                {title}
              </h1>
            )}
            {dirty ? (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)'
                }}
              >
                <IconButton
                  icon="refresh-cw"
                  label="Sync to Notion"
                  size="sm"
                  onClick={() => void save()}
                  disabled={saving}
                />
                <IconButton icon="x" label="Discard changes" size="sm" onClick={discard} disabled={saving} />
              </div>
            ) : null}
          </div>

          <aside
            style={{
              boxSizing: 'border-box',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              background: 'transparent',
              overflow: 'hidden'
            }}
          >
            {/* Two equal halves with a full-height rule between them, as in the skill view. */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1px 1fr',
                borderBottom: '1px solid var(--border-default)'
              }}
            >
              <div style={{ padding: 'var(--space-7)', minWidth: 0 }}>
                <h3 style={{ ...headingStyle, marginBottom: 'var(--space-3)' }}>Name</h3>
                {loading ? (
                  <Skeleton height={FIELD_HEIGHT} radius="var(--radius-md)" />
                ) : (
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    style={{ ...editFieldStyle, height: FIELD_HEIGHT }}
                  />
                )}
              </div>

              <div style={{ background: 'var(--border-default)' }} />

              <div style={{ padding: 'var(--space-7)', minWidth: 0 }}>
                <h3 style={{ ...headingStyle, marginBottom: 'var(--space-3)' }}>Color</h3>
                {loading ? (
                  <Skeleton height={FIELD_HEIGHT} radius="var(--radius-md)" delay={0.08} />
                ) : (
                  <label
                    style={{
                      display: 'block',
                      width: '100%',
                      height: FIELD_HEIGHT,
                      boxSizing: 'border-box',
                      borderRadius: 'var(--radius-md)',
                      background: color,
                      border: '1px solid var(--border-default)',
                      cursor: 'pointer'
                    }}
                  >
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColorDraft(e.target.value)}
                      style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}
                    />
                  </label>
                )}
              </div>
            </div>

            <div style={panelStyle()}>
              <h3 style={{ ...headingStyle, marginBottom: 'var(--space-3)' }}>Instructions</h3>
              {loading ? (
                <SkeletonLines delay={0.16} />
              ) : (
                <textarea
                  className="chatscroll"
                  value={instructionsDraft}
                  onChange={(e) => setInstructionsDraft(e.target.value)}
                  style={editTextareaStyle}
                />
              )}
            </div>

            <div style={panelStyle(true)}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-6)',
                  marginBottom: 'var(--space-6)'
                }}
              >
                <h3 style={headingStyle}>Context</h3>
                <div ref={addButtonRef} style={{ flex: '0 0 auto' }}>
                  <IconButton
                    icon="plus"
                    label="Add context"
                    size="sm"
                    active={addAnchor !== null}
                    onClick={() => {
                      if (addAnchor) {
                        setAddAnchor(null)
                        return
                      }
                      const rect = addButtonRef.current?.getBoundingClientRect()
                      if (!rect) return
                      setAddAnchor(rect)
                      loadAttachable()
                    }}
                  />
                  {addAnchor ? (
                    <AddContextMenu
                      anchor={addAnchor}
                      chats={attachableChats}
                      people={attachablePeople}
                      onAttachChat={(id) => {
                        setAddAnchor(null)
                        void attachChat(id)
                      }}
                      onAttachPerson={(id) => {
                        setAddAnchor(null)
                        void attachPerson(id)
                      }}
                      onNew={() => {
                        setAddAnchor(null)
                        setCreatingContext(true)
                      }}
                      onClose={() => setAddAnchor(null)}
                    />
                  ) : null}
                </div>
              </div>
              {loading ? (
                <ContextCardsSkeleton />
              ) : error ? (
                <span style={emptyStyle}>Couldn&apos;t load this project.</span>
              ) : contextItems.length === 0 ? (
                <ContextPlaceholder />
              ) : (
                <ContextCards items={contextItems} />
              )}
            </div>
          </aside>
        </div>
      </div>
      </div>
    </main>
  )
}
