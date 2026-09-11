import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, MouseEvent, ReactElement } from 'react'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton, SkeletonLines } from '@/components/ui/skeleton'
import { SectionLabel } from '@/components/ui/section-label'
import { Switch } from '@/components/ui/switch'
import { blocksToMarkdown } from '@shared/markdown'
import { listOrdinals } from '@/lib/listOrdinals'
import { folderByItemId, folderMemberIds } from '@shared/context'
import { parseAffiliations, serializeAffiliations } from '@shared/affiliations'
import { normalizeNotionId, sameNotionId } from '@shared/notionId'
import type { ContextFolder } from '@shared/context'
import {
  loadContextGrouping,
  loadContextView,
  saveContextGrouping,
  saveContextView
} from '@/lib/contextView'
import type { ContextViewMode } from '@/lib/contextView'

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

export interface ProjectDetail {
  id: string
  title: string
  lastEdited: string | null
  instructions: string
  color: string | null
  blocks: DetailBlock[]
  chats: ProjectChatEntry[]
  people: PersonEntry[]
  folders: ContextFolder[]
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


/** A folder's name, being typed. Used by the card that names a new folder and by the one renaming an
    existing one, so the two behave alike: Enter keeps it, Escape throws the edit away, and clicking
    away keeps it — walking off a name already typed reads as being done with it, not as calling it
    off.

    Everything it does is stopped from reaching the card underneath, which would otherwise open the
    folder on the click that put the cursor in the field. */
function FolderNameField({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit: (name: string) => void
  onCancel: () => void
}): ReactElement {
  const [name, setName] = useState(initial)

  const commit = (): void => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== initial) onCommit(trimmed)
    else onCancel()
  }

  return (
    <input
      autoFocus
      value={name}
      placeholder="Folder name"
      onChange={(e) => setName(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={commit}
      style={{
        flex: '1 1 auto',
        width: '100%',
        minWidth: 0,
        padding: 0,
        background: 'transparent',
        border: 'none',
        outline: 'none',
        /* The card is the field here, so the global focus ring in tokens.css would draw a second
           border inside the one already around it. Inline, so it outranks that rule. */
        boxShadow: 'none',
        font: 'var(--weight-semibold) 13px/1.35 var(--font-sans)',
        color: 'var(--text-primary)',
        letterSpacing: 'var(--tracking-tight)'
      }}
    />
  )
}

/** The pencil that turns a folder's title into that field. Shown while the card is under the pointer
    — a name is not something you change often enough for the button to sit there all the time. */
function RenameButton({ onClick }: { onClick: () => void }): ReactElement {
  const [hover, setHover] = useState(false)

  return (
    <button
      type="button"
      aria-label="Rename folder"
      title="Rename folder"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        flex: '0 0 auto',
        alignItems: 'center',
        justifyContent: 'center',
        width: 18,
        height: 18,
        padding: 0,
        background: hover ? '#3a3a38' : 'transparent',
        border: 'none',
        borderRadius: 4,
        color: hover ? 'var(--text-primary)' : 'var(--text-faint)',
        cursor: 'pointer',
        transition: 'var(--transition-control)'
      }}
    >
      <Icon name="pencil" size={12} />
    </button>
  )
}

function ContextCard({
  title,
  subtitle,
  badge,
  onOpen,
  onRemove,
  removeLabel,
  onRename
}: {
  title: string
  /** A word about what is inside, used by folders for their item count. */
  subtitle?: string
  /** Icon name for the card's kind: a Notion page, a chat, a person, or a folder. */
  badge: string
  onOpen: () => void
  onRemove: () => void
  removeLabel: string
  /** Folders only: renaming anything else means opening it. */
  onRename?: (name: string) => void
}): ReactElement {
  const [hover, setHover] = useState(false)
  const [focusRemove, setFocusRemove] = useState(false)
  const [hoverRemove, setHoverRemove] = useState(false)
  const [renaming, setRenaming] = useState(false)
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
      {renaming && onRename ? (
        <FolderNameField
          initial={title}
          onCommit={(name) => {
            setRenaming(false)
            onRename(name)
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 4, minWidth: 0 }}>
          <span
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              font: 'var(--weight-semibold) 13px/1.35 var(--font-sans)',
              color: 'var(--text-primary)',
              letterSpacing: 'var(--tracking-tight)',
              wordBreak: 'break-word'
            }}
          >
            {title}
          </span>
          {onRename && hover ? <RenameButton onClick={() => setRenaming(true)} /> : null}
        </span>
      )}
      <span style={{ flex: '1 1 auto' }} />
      {/* The kind, as the same glyph its section uses in the sidebar, so a card is recognised
          without reading it. Square rather than the old text pill: with the word gone there is
          nothing to set the width. A folder's count sits beside it rather than under the title,
          where it reads as part of the glyph — how many of this thing — instead of as a second line
          competing with the name. */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
        <span
          style={{
            flex: '0 0 auto',
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
        {subtitle ? (
          <span
            style={{
              minWidth: 0,
              font: 'var(--type-meta)',
              color: 'var(--text-faint)',
              letterSpacing: 'var(--tracking-tight)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
    </div>
  )
}

/** The same item as `ContextCard`, one line high: badge, title, remove. The grid trades height for
    a scannable shape; this trades the shape for density, so a project with a dozen pages attached
    stays readable without scrolling the panel. */
function ContextRow({
  title,
  subtitle,
  badge,
  onOpen,
  onRemove,
  removeLabel,
  onRename
}: {
  title: string
  /** A word about what is inside, used by folders for their item count. */
  subtitle?: string
  /** Icon name for the row's kind — see `ContextCard`. */
  badge: string
  onOpen: () => void
  onRemove: () => void
  removeLabel: string
  /** Folders only: renaming anything else means opening it. */
  onRename?: (name: string) => void
}): ReactElement {
  const [hover, setHover] = useState(false)
  const [focusRemove, setFocusRemove] = useState(false)
  const [hoverRemove, setHoverRemove] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const showRemove = hover || focusRemove

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        /* Same as the card: the remove button's own Enter would otherwise bubble up and open what
           it just removed. */
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 36,
        padding: '0 6px 0 8px',
        boxSizing: 'border-box',
        background: hover ? '#282826' : '#212120',
        border: `1px solid ${hover ? '#3a3a38' : '#2b2b29'}`,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'var(--transition-control)'
      }}
    >
      {/* Unboxed here: at row height the card's plate would eat most of the line, and the glyph
          alone is enough to tell the kinds apart. */}
      <span
        style={{
          display: 'inline-flex',
          flex: '0 0 auto',
          alignItems: 'center',
          justifyContent: 'center',
          width: 18,
          color: 'var(--text-body)'
        }}
      >
        <Icon name={badge} size={badge === 'notion' || badge === 'user' ? 16 : 14} />
      </span>
      {renaming && onRename ? (
        <FolderNameField
          initial={title}
          onCommit={(name) => {
            setRenaming(false)
            onRename(name)
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <>
          <span
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              font: 'var(--weight-semibold) 13px/1.35 var(--font-sans)',
              color: 'var(--text-primary)',
              letterSpacing: 'var(--tracking-tight)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            title={title}
          >
            {title}
          </span>
          {onRename && hover ? <RenameButton onClick={() => setRenaming(true)} /> : null}
        </>
      )}
      {subtitle ? (
        <span
          style={{
            flex: '0 0 auto',
            font: 'var(--type-meta)',
            color: 'var(--text-faint)',
            letterSpacing: 'var(--tracking-tight)'
          }}
        >
          {subtitle}
        </span>
      ) : null}
      {/* Sits in the row rather than on its corner — there is no corner to spare — and holds its
          width while hidden so the title never reflows on hover. */}
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
          display: 'flex',
          flex: '0 0 auto',
          alignItems: 'center',
          justifyContent: 'center',
          width: 22,
          height: 22,
          padding: 0,
          background: hoverRemove ? '#3a3a38' : 'transparent',
          border: 'none',
          borderRadius: 4,
          color: 'var(--text-primary)',
          cursor: 'pointer',
          opacity: showRemove ? 1 : 0,
          pointerEvents: showRemove ? 'auto' : 'none',
          transition: 'var(--transition-control)'
        }}
      >
        <Icon name="x" size={13} style={{ opacity: hoverRemove ? 1 : 0.7 }} />
      </button>
    </div>
  )
}

/** One thing chosen from the add menu, and what list it came from. */
interface ContextPick {
  id: string
  kind: 'chat' | 'person' | 'page'
}

/** The "add context" menu: pick what kind of thing to attach, then which one.

    Two levels rather than one flat list. The three kinds are picked from what already exists — a
    page is a row in Pages like the others, so one that exists is attached rather than made again —
    and the rows below the rule make something new instead. */
function AddContextMenu({
  chats,
  people,
  pages,
  onAttach,
  onNew,
  onNewFolder,
  onClose,
  anchor
}: {
  chats: Array<{ id: string; name: string }>
  /** `meta` is what a person is affiliated with, shown at the right of their row. */
  people: Array<{ id: string; name: string; meta?: string }>
  /** Every page not already in this project — or, inside a folder, not already in the folder. */
  pages: Array<{ id: string; name: string }>
  /** Everything picked at once. A plain click sends one; a run of ctrl-clicks sends the lot when
      ctrl comes back up. */
  onAttach: (picks: ContextPick[]) => void
  onNew: () => void
  /** Absent inside a folder: the panel is one level deep, so a folder has nowhere to go in there. */
  onNewFolder?: () => void
  onClose: () => void
  /** Where the button sits on screen. The menu is portalled to the body and positioned from this,
      because the panel it lives in clips its own overflow to keep its rounded corners. */
  anchor: DOMRect
}): ReactElement {
  const [kind, setKind] = useState<'chat' | 'person' | 'page' | null>(null)
  /* What ctrl-clicking has marked so far, in the order it was picked. Held across a switch between
     the two lists, so a chat and a person can go in together. */
  const [marked, setMarked] = useState<ContextPick[]>([])

  /* Letting go of ctrl is the commit. The listener is on the window rather than the menu because
     the release often happens with the pointer somewhere else entirely, and a keyup only reaches a
     focused element. */
  useEffect(() => {
    function onKeyUp(event: KeyboardEvent): void {
      if (event.key !== 'Control' && event.key !== 'Meta') return
      if (marked.length > 0) onAttach(marked)
    }

    window.addEventListener('keyup', onKeyUp)
    return () => window.removeEventListener('keyup', onKeyUp)
  }, [marked, onAttach])

  /* One row shape for all three lists: only a person carries a second column, and the others simply
     leave it empty. */
  const list: Array<{ id: string; name: string; meta?: string }> =
    kind === 'chat' ? chats : kind === 'person' ? people : pages
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
          label="Chats"
          trailing="chevron-right"
          active={kind === 'chat'}
          onHover={() => setKind('chat')}
          onClick={() => setKind('chat')}
        />
        <MenuItem
          label="People"
          trailing="chevron-right"
          active={kind === 'person'}
          onHover={() => setKind('person')}
          onClick={() => setKind('person')}
        />
        <MenuItem
          label="Pages"
          trailing="chevron-right"
          active={kind === 'page'}
          onHover={() => setKind('page')}
          onClick={() => setKind('page')}
        />
        {/* Ruled off from the three above it: those name a list to attach from, these make something
            that does not exist yet — a page, and somewhere to keep them — which is what the plus
            says. */}
        <div
          style={{
            height: 1,
            margin: 'var(--space-2) calc(var(--space-2) * -1)',
            background: 'var(--border-default)'
          }}
        />
        {/* Hovering a row with no list of its own closes whichever one is open, so the flyout tracks
            the pointer rather than lingering over an unrelated row. */}
        <MenuItem label="Page" trailing="plus" onHover={() => setKind(null)} onClick={onNew} />
        {onNewFolder ? (
          <MenuItem label="Folder" trailing="plus" onHover={() => setKind(null)} onClick={onNewFolder} />
        ) : null}

        {/* Alongside rather than replacing, the way the effort menu sits beside the model menu — the
            kind stays visible while its list is being read. */}
        {kind ? (
          /* The 12px separation is this wrapper's padding rather than an offset, so crossing it
             keeps the pointer inside the menu and the flyout does not flicker shut on the way. */
          <div style={{ position: 'absolute', left: '100%', top: 0, paddingLeft: 12 }}>
          {/* `menuscroll` rather than `chatscroll`: the same bar the chat window draws, without the
              stable gutter, which would inset both edges by 10px and leave this panel padded
              differently from the one it hangs off. */}
          {/* People get a wider, taller panel: their rows carry a name and an affiliation, and at the
              width the other two lists want the two would be fighting over the same 200px. */}
          <div
            className="menuscroll"
            style={{
              ...panelStyle,
              minWidth: kind === 'person' ? 340 : 200,
              maxHeight: kind === 'person' ? 380 : 260,
              overflowY: 'auto'
            }}
          >
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
                {kind === 'chat'
                  ? 'No other chats'
                  : kind === 'person'
                    ? 'No people yet'
                    : 'No other pages'}
              </div>
            ) : (
              list.map((entry) => (
                <MenuItem
                  key={entry.id}
                  label={entry.name || 'Untitled'}
                  meta={entry.meta}
                  selected={marked.some((pick) => pick.id === entry.id)}
                  onClick={(event) => {
                    const pick: ContextPick = { id: entry.id, kind: kind ?? 'chat' }
                    /* Cmd stands in for ctrl on a Mac keyboard, and releasing it fires the same
                       keyup this menu is listening for. */
                    if (!event.ctrlKey && !event.metaKey) {
                      onAttach([pick])
                      return
                    }
                    setMarked((current) =>
                      current.some((p) => p.id === pick.id)
                        ? current.filter((p) => p.id !== pick.id)
                        : current.concat(pick)
                    )
                  }}
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
  meta,
  trailing,
  active,
  selected,
  onHover,
  onClick
}: {
  label: string
  /** A quiet second column at the right of the row — a person's affiliations. */
  meta?: string
  /** The glyph at the row's right edge: a chevron on the rows that open a list beside the menu, a
      plus on the ones that make something. */
  trailing?: string
  active?: boolean
  /** Marked by a ctrl-click and waiting to be sent, rather than acted on already. */
  selected?: boolean
  /** Rows that open a list do it on hover; the click is kept so the row still works from a keyboard
      or a tap, where there is no hover to speak of. */
  onHover?: () => void
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
}): ReactElement {
  /* A marked row holds its own background whether or not the pointer is on it — that is the whole
     of what marking looks like, and it has to survive the pointer moving down the list. */
  const background = selected ? 'var(--surface-selected)' : active ? 'var(--surface-hover)' : 'transparent'

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
        if (!selected) e.currentTarget.style.background = 'var(--surface-hover)'
        onHover?.()
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = background)}
    >
      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {meta ? (
        <span
          style={{
            flex: '0 1 auto',
            minWidth: 0,
            maxWidth: '50%',
            font: 'var(--type-meta)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-faint)',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {meta}
        </span>
      ) : null}
      {selected ? (
        <span style={{ display: 'inline-flex', flex: '0 0 auto', color: 'var(--text-primary)' }}>
          <Icon name="check" size={14} />
        </span>
      ) : trailing ? (
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
  subtitle?: string
  kind: ContextItemKind
  /** Folders only: what the pencil on the card commits to. */
  onRename?: (name: string) => void
  /** Icon name for the card's kind — see `ContextCard`. */
  badge: string
  onOpen: () => void
  onRemove: () => void
  removeLabel: string
}

/* Four to a row, each column taking an equal share of whatever the panel is wide, so a row ends
   flush with the panel's edge instead of trailing off into empty space. `minmax(0, 1fr)` rather
   than `1fr` so a long unbroken title shrinks its card rather than widening the column. */
const CONTEXT_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 12
}

/** Stand-in for the context items: blocks at whatever the real ones measure in this view, so the
    panel keeps its height and nothing below it jumps. */
function ContextCardsSkeleton({ view }: { view: ContextViewMode }): ReactElement {
  if (view === 'list') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={36} radius={6} delay={i * 0.12} />
        ))}
      </div>
    )
  }

  return (
    <div style={CONTEXT_GRID_STYLE}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={125} radius={8} delay={i * 0.12} />
      ))}
    </div>
  )
}

/** What a context item is. Drives the badge it wears, the section it falls into when the panel is
    split by kind, and whether it can be dropped onto. */
type ContextItemKind = 'folder' | 'page' | 'chat' | 'person'

/** The drag in progress, held by the panel rather than by a layout. Split into sections, the panel
    renders one `ContextCards` per kind, and a chat dragged out of its own section has to still be
    recognised as it passes over a folder in another — which it cannot be if each layout remembers
    its own drag. */
interface ContextDrag {
  id: string | null
  kind: ContextItemKind | null
  overId: string | null
  start: (id: string, kind: ContextItemKind) => void
  over: (id: string | null) => void
  end: () => void
}

function ContextCards({
  items,
  view,
  newFolder,
  onFile,
  drag
}: {
  items: ContextCardItem[]
  view: ContextViewMode
  /** Renders the naming card at the head of the layout while a folder is being created. */
  newFolder?: { onCommit: (name: string) => void; onCancel: () => void }
  /** Files the dragged item into the folder it was dropped on, which moves it in Notion. */
  onFile: (dragId: string, folderId: string) => void
  drag: ContextDrag
}): ReactElement {
  const Item = view === 'list' ? ContextRow : ContextCard

  /* Dragging is for filing and nothing else: a card can be dropped on a folder, and everywhere else
     is inert. A folder cannot be dropped into another, since the panel is one level deep. */
  const canDrop = (item: ContextCardItem): boolean =>
    item.kind === 'folder' && drag.id !== null && drag.kind !== 'folder' && drag.id !== item.id

  return (
    <div
      style={view === 'list' ? { display: 'flex', flexDirection: 'column', gap: 6 } : CONTEXT_GRID_STYLE}
    >
      {newFolder ? (
        <NewFolderCard view={view} onCommit={newFolder.onCommit} onCancel={newFolder.onCancel} />
      ) : null}
      {items.map((item) => (
        <div
          key={item.id}
          draggable
          onDragStart={(e) => {
            drag.start(item.id, item.kind)
            e.dataTransfer.effectAllowed = 'move'
            /* Firefox starts no drag at all without payload, and the id is the whole of it —
               everything else is read from the panel's own state. */
            e.dataTransfer.setData('text/plain', item.id)
          }}
          onDragEnd={drag.end}
          onDragOver={(e) => {
            if (!canDrop(item)) return
            /* Preventing the default is what marks this a drop target at all. */
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (drag.overId !== item.id) drag.over(item.id)
          }}
          onDragLeave={(e) => {
            /* Only when the pointer has actually left the card: moving over the card's own children
               fires this too, and clearing then would make the outline flicker. */
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
            if (drag.overId === item.id) drag.over(null)
          }}
          onDrop={(e) => {
            if (!canDrop(item) || !drag.id) return
            e.preventDefault()
            onFile(drag.id, item.id)
            drag.end()
          }}
          style={{
            position: 'relative',
            minWidth: 0,
            /* The card being dragged dims in place rather than leaving the layout: nothing is being
               rearranged, so the row it came from should not move while it is carried. */
            opacity: drag.id === item.id ? 0.4 : 1,
            borderRadius: view === 'list' ? 6 : 8,
            boxShadow: drag.overId === item.id ? '0 0 0 2px var(--accent)' : 'none',
            transition: 'var(--transition-control)'
          }}
        >
          <Item
            title={item.title}
            subtitle={item.subtitle}
            badge={item.badge}
            onOpen={item.onOpen}
            onRemove={item.onRemove}
            removeLabel={item.removeLabel}
            onRename={item.onRename}
          />
        </div>
      ))}
    </div>
  )
}

/** The grid/list switch: two segments in one plate, the active one lit. Sits next to the panel's
    add button, so the two controls read as one group. */
function ContextViewToggle({
  view,
  onChange
}: {
  view: ContextViewMode
  onChange: (view: ContextViewMode) => void
}): ReactElement {
  const segment = (mode: ContextViewMode, icon: string, label: string): ReactElement => {
    const active = view === mode
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={active}
        onClick={() => onChange(mode)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 24,
          height: 22,
          padding: 0,
          background: active ? '#3a3a38' : 'transparent',
          border: 'none',
          borderRadius: 4,
          color: active ? 'var(--text-primary)' : 'var(--text-faint)',
          cursor: 'pointer',
          transition: 'var(--transition-control)'
        }}
      >
        <Icon name={icon} size={14} />
      </button>
    )
  }

  return (
    <div
      role="group"
      aria-label="Context layout"
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 2,
        background: '#212120',
        border: '1px solid #2b2b29',
        borderRadius: 6
      }}
    >
      {segment('grid', 'layout-grid', 'Block view')}
      {segment('list', 'list', 'List view')}
    </div>
  )
}

/** A folder being named, drawn in place of the card it is about to become — so the new folder is
    already sitting where it will live while its name is typed, rather than in a dialog somewhere
    else. Naming and renaming share the same field, so the two behave alike. */
function NewFolderCard({
  view,
  onCommit,
  onCancel
}: {
  view: ContextViewMode
  onCommit: (name: string) => void
  onCancel: () => void
}): ReactElement {
  const field = <FolderNameField initial="" onCommit={onCommit} onCancel={onCancel} />

  if (view === 'list') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          height: 36,
          padding: '0 6px 0 8px',
          boxSizing: 'border-box',
          background: '#212120',
          border: '1px solid #2b2b29',
          borderRadius: 6
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            flex: '0 0 auto',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            color: 'var(--text-body)'
          }}
        >
          <Icon name="folder" size={14} />
        </span>
        {field}
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 125,
        padding: '13px 14px 12px',
        boxSizing: 'border-box',
        background: '#212120',
        border: '1px solid #2b2b29',
        borderRadius: 8
      }}
    >
      {field}
      <span style={{ flex: '1 1 auto' }} />
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
        <Icon name="folder" size={16} />
      </span>
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

/* Full-page context view — replaces the project overview, in place of a modal.

   Also what the Pages section opens, where a page belongs to no project and there is no project
   crumb to draw: `projectTitle` is null there and the trail is just "Pages / this page". */
export function ContextPageView({
  rootLabel = 'Projects',
  projectTitle,
  detail,
  loading,
  error,
  onBackToProjects,
  onBackToProject,
  onSave
}: {
  rootLabel?: string
  projectTitle: string | null
  detail: ProjectDetail | null
  loading: boolean
  error: boolean
  onBackToProjects: () => void
  onBackToProject: () => void
  onSave: (title: string, text: string) => Promise<void>
}): ReactElement {
  const blocks = detail?.blocks.filter((b) => b.type !== 'child_page') ?? []
  const ordinals = listOrdinals(blocks)
  const title = detail?.title || 'Untitled'

  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  /* Markdown, so a heading edited here is written back as a heading rather than being flattened to
     a paragraph on save. Images are in it as `![caption](url)`: leaving them out was what deleted
     them on save, since the draft is the whole of what the page is rewritten from. Child pages are
     still left out — a page inside this one is not part of its body. */
  const original = blocksToMarkdown(blocks.filter((b) => b.type !== 'child_page'))
  /* The title is edited alongside the body and written by the same Sync, the way a person's name is
     — one edit mode over the whole page rather than a separate gesture for the heading. */
  const originalTitle = detail?.title ?? ''
  const dirty = draft !== original || titleDraft !== originalTitle

  function startEditing(): void {
    setTitleDraft(originalTitle)
    setDraft(original)
    setEditing(true)
  }

  async function sync(): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      await onSave(titleDraft, draft)
      setEditing(false)
    } catch (err) {
      console.error('[project] context page save failed:', err)
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
          {rootLabel}
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        {projectTitle === null ? null : (
          <>
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
          </>
        )}
        {/* The last crumb is this page's own title, which arrives with the page — the two above it
            are already known, so only this one has anything to wait for. */}
        {loading ? (
          <Skeleton height={11} width={96} radius={3} />
        ) : (
          <span style={{ color: 'var(--text-primary)' }}>{editing ? titleDraft || 'Untitled' : title}</span>
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
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-10)',
            marginBottom: 'var(--space-10)'
          }}
        >
          {editing ? (
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Untitled"
              style={{
                flex: '1 1 auto',
                minWidth: 0,
                boxSizing: 'border-box',
                padding: '2px 0',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                font: 'var(--type-title)',
                letterSpacing: 'var(--tracking-display)',
                outline: 'none',
                boxShadow: 'none'
              }}
            />
          ) : (
            <h1
              style={{
                margin: 0,
                flex: '1 1 auto',
                minWidth: 0,
                font: 'var(--type-title)',
                color: 'var(--text-primary)',
                letterSpacing: 'var(--tracking-display)'
              }}
            >
              {/* The title arrives with the page, so it waits with it rather than sitting finished
                  above a body that is still loading. */}
              {loading ? <Skeleton height={38} width="42%" /> : title}
            </h1>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flex: '0 0 auto', paddingTop: 4 }}>
            {editing && dirty ? (
              <IconButton icon="refresh-cw" label="Sync to Notion" size="sm" onClick={() => void sync()} disabled={saving} />
            ) : null}
            <IconButton
              icon="pencil"
              label={editing ? 'Cancel edit' : 'Edit page'}
              size="sm"
              active={editing}
              disabled={loading || error}
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
            <>
              <SkeletonLines lines={4} />
              <Skeleton height={18} width="40%" delay={0.3} />
              <SkeletonLines lines={3} delay={0.36} />
            </>
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
              if (tag === 'h3' || tag === 'h4') {
                return (
                  <h3 key={b.id} style={{ ...headingStyle, margin: 0 }}>
                    {b.text}
                  </h3>
                )
              }
              if (tag === 'li') {
                /* Every list kind carries its own marker: a number counted off the run it is in, a
                   box for a to-do, a dot for the rest. Without one the three read as indented
                   paragraphs and a numbered list loses the only thing that made it one. */
                const marker =
                  b.type === 'to_do'
                    ? b.checked
                      ? '☑'
                      : '☐'
                    : b.type === 'numbered_list_item'
                      ? `${ordinals.get(b.id) ?? 1}.`
                      : '•'
                return (
                  <p key={b.id} style={{ ...panelBodyStyle, margin: 0, paddingLeft: 'var(--space-6)' }}>
                    {marker} {b.text}
                  </p>
                )
              }
              return (
                <p key={b.id} style={{ ...panelBodyStyle, margin: 0 }}>
                  {b.text}
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
  const [contextView, setContextView] = useState<ContextViewMode>(loadContextView)
  const [grouped, setGrouped] = useState<boolean>(loadContextGrouping)
  const [dragging, setDragging] = useState<{ id: string; kind: ContextItemKind } | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  /* Which folder the Context panel is showing the inside of, and whether a new one is being named.
     Both are about this visit rather than about the project, so neither is persisted: leaving the
     project and coming back lands at the top level. */
  const [openFolderId, setOpenFolderId] = useState<string | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [openContextId, setOpenContextId] = useState<string | null>(null)
  const [creatingContext, setCreatingContext] = useState(false)
  /* The button's position on screen, captured when the menu opens: the menu is portalled out of
     the panel (which clips its overflow) and so has to be placed from real coordinates. */
  const [addAnchor, setAddAnchor] = useState<DOMRect | null>(null)
  const addButtonRef = useRef<HTMLDivElement | null>(null)
  /* Everything attachable, loaded when the menu is first opened rather than with the project — the
     lists are only ever seen from inside the menu. */
  const [allChats, setAllChats] = useState<Array<{ id: string; name: string }>>([])
  const [allPeople, setAllPeople] = useState<Array<{ id: string; name: string; affiliation: string }>>([])
  const [allPages, setAllPages] = useState<Array<{ id: string; title: string }>>([])
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

  /* A folder can vanish under the panel: deleted from another window, or dropped by a reload that
     found it gone from Notion. Falling back to the top level beats showing an empty folder that no
     longer exists. */
  useEffect(() => {
    if (openFolderId && detail && !detail.folders.some((f) => f.id === openFolderId)) {
      setOpenFolderId(null)
    }
  }, [detail, openFolderId])

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
    /* Picking another project in the sidebar swaps this view's `projectId` rather than remounting
       it, so everything drilled into from the old one has to be let go of by hand: without this the
       page or folder being viewed stays on screen and the new project loads in behind it. */
    setOpenContextId(null)
    setOpenFolderId(null)
    setCreatingContext(false)
    setCreatingFolder(false)
    setAddAnchor(null)
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

  /** Takes a page out of the project, or out of the folder holding it, by dropping the link. The
      page itself stays in the Pages table, so this is a removal and not a deletion — the same as taking a
      chat or a person out. Deleting the page for good is done from the Pages section.

      A page still nested inside the project from before pages moved to Pages has no link to drop,
      so the write does nothing and the reload puts its card back. Dragging it into and out of a
      folder is what converts it. */
  async function removeContextPage(id: string, parentId: string): Promise<void> {
    /* Off the project or out of whichever folder holds it — a page opened from inside a folder is
       not among the project's own blocks, so filtering those alone would leave its card sitting
       there until the next read. */
    setDetail((d) =>
      d
        ? {
            ...d,
            blocks: d.blocks.filter((b) => b.id !== id),
            folders: d.folders.map((f) => ({ ...f, pages: f.pages.filter((p) => p.id !== id) }))
          }
        : d
    )
    try {
      await window.api.removeContextPage(parentId, id)
    } catch (err) {
      console.error('[project] removeContextPage failed:', err)
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

    window.api
      .getPages()
      .then(setAllPages)
      .catch((err) => console.error('[project] getPages failed:', err))
  }

  /** Attaches everything picked in one go, then re-reads the project once.

      Chats and people are the same operation now: a link on the page they are being put in — the
      project, or the folder if one is open. One request for the whole batch, whatever is in it. */
  async function attachMany(picks: ContextPick[]): Promise<void> {
    if (!detail || picks.length === 0) return

    try {
      await window.api.linkContext(openFolderId ?? projectId, picks.map((p) => p.id))
      load()
    } catch (err) {
      console.error('[project] attach failed:', err)
      load()
    }
  }

  async function detachPerson(personId: string): Promise<void> {
    if (!detail) return
    setDetail((d) => (d ? { ...d, people: d.people.filter((p) => p.id !== personId) } : d))
    try {
      await window.api.unlinkContext(projectId, personId)
    } catch (err) {
      console.error('[project] unlinkContext failed:', err)
      load()
    }
  }

  /** Unlinks instead of deleting: the chat keeps its row in Chats and loses only the link
      that put it in this project, so it stays reachable from the sidebar. */
  async function unlinkChat(id: string): Promise<void> {
    const projectTitle = detail?.title
    if (!projectTitle) return

    setDetail((d) => (d ? { ...d, chats: d.chats.filter((c) => c.id !== id) } : d))
    try {
      await window.api.unlinkContext(projectId, id)
      onChatUnlinked?.(id, projectId, projectTitle)
    } catch (err) {
      console.error('[project] unlinkChatFromProject failed:', err)
      load()
    }
  }

  const folders = detail?.folders ?? []
  const openFolder = folders.find((f) => f.id === openFolderId) ?? null

  /** Creates the folder's page in Notion, then re-reads the project so the new folder arrives with
      the id Notion gave it. No optimistic card: the page has to exist before anything can be put in
      it, and the round trip is what produces the id everything else is keyed by. */
  async function createFolder(name: string): Promise<void> {
    setCreatingFolder(false)
    try {
      await window.api.createContextFolder(projectId, name)
      load()
    } catch (err) {
      console.error('[project] createContextFolder failed:', err)
    }
  }

  /** Renames the folder's page, which is where its name lives. The marker that makes it a folder is
      put back on in the service, so the name typed here is the name without it. */
  async function renameFolder(id: string, name: string): Promise<void> {
    setDetail((d) => (d ? { ...d, folders: d.folders.map((f) => (f.id === id ? { ...f, name } : f)) } : d))
    try {
      await window.api.renameContextFolder(id, name)
    } catch (err) {
      console.error('[project] renameContextFolder failed:', err)
    } finally {
      load()
    }
  }

  /** Archives the folder's page. What was inside it in Notion — its context pages — goes to the
      trash with it, recoverable there. Chats and people were only recorded on that page, so they
      keep their attachment and reappear at the project's top level. */
  async function deleteFolder(id: string): Promise<void> {
    if (openFolderId === id) setOpenFolderId(null)
    setDetail((d) => (d ? { ...d, folders: d.folders.filter((f) => f.id !== id) } : d))
    try {
      await window.api.deleteContextFolder(id)
    } catch (err) {
      console.error('[project] deleteContextFolder failed:', err)
      load()
    }
  }

  /** Files anything under a folder: linked from the folder page instead of from the project's.
      Pages come through here too now that they are linked rather than nested.

      The link on the project is dropped as the one on the folder is written, so the page says where
      the thing is once rather than in two places. */
  async function fileInFolder(itemId: string, folderId: string): Promise<void> {
    try {
      await window.api.linkContext(folderId, [itemId])
      await window.api.unlinkContext(projectId, itemId)
    } catch (err) {
      console.error('[project] file in folder failed:', err)
    }
  }

  /** Takes anything back out to the project's top level, leaving it attached. This is what the
      remove button does from inside a folder, for a page as much as for a chat: a page is linked
      from the folder like everything else, so it unfiles like everything else. */
  async function unfile(itemId: string, folderId: string): Promise<void> {
    setDetail((d) =>
      d
        ? {
            ...d,
            folders: d.folders.map((f) =>
              f.id === folderId
                ? {
                    ...f,
                    items: f.items.filter((i) => i !== itemId),
                    pages: f.pages.filter((p) => p.id !== itemId)
                  }
                : f
            )
          }
        : d
    )
    try {
      /* Linked to the project before the folder's link goes, so it never stops being in the project
         on its way to the top level. */
      await window.api.linkContext(projectId, [itemId])
      await window.api.unlinkContext(folderId, itemId)
    } catch (err) {
      console.error('[project] unfile failed:', err)
    } finally {
      load()
    }
  }

  const blocks = detail?.blocks ?? []
  const recents = blocks.filter((b) => b.type === 'child_page')
  const chats = detail?.chats ?? []
  const people = detail?.people ?? []
  /* Already-attached things are dropped from the menu: attaching one twice does nothing, and an
     option that does nothing should not be offered.

     Inside a folder the bar is what is already in that folder rather than what is in the project,
     so something attached at the top level can be filed by picking it here — attaching it again is
     the no-op, and the file is the part that does the work. */
  /* Compared with `sameNotionId` rather than by string: an id listed by a folder has had its dashes
     stripped, and the ones on these lists have not, so a plain comparison offers something already
     attached all over again. */
  const inOpenFolder = (id: string): boolean =>
    openFolder !== null && folderMemberIds(openFolder).some((member) => sameNotionId(member, id))

  const attachableChats = allChats.filter((c) =>
    openFolder ? !inOpenFolder(c.id) : !chats.some((attached) => sameNotionId(attached.id, c.id))
  )
  const attachablePeople = allPeople
    .filter((p) => (openFolder ? !inOpenFolder(p.id) : !people.some((attached) => sameNotionId(attached.id, p.id))))
    /* Read and rewritten rather than passed through, so a column spaced by hand in Notion still
       reads as one list here. */
    .map((p) => ({ id: p.id, name: p.name, meta: serializeAffiliations(parseAffiliations(p.affiliation)) }))
  /* A page filed in one of this project's folders is in the project too, so it is not offered again
     at the top level — unlike a chat or a person, an attached page is not one list but two: the
     project's own blocks, and whatever its folders hold. */
  const inProject = (id: string): boolean =>
    recents.some((r) => sameNotionId(r.id, id)) ||
    folders.some((f) => folderMemberIds(f).some((member) => sameNotionId(member, id)))
  const attachablePages = allPages
    .filter((p) => (openFolder ? !inOpenFolder(p.id) : !inProject(p.id)))
    .map((p) => ({ id: p.id, name: p.title }))

  /* Every attached thing, folder or no folder. What the panel shows is a slice of this: the ones
     filed under the open folder, or the unfiled ones plus a card per folder. */
  const allItems: ContextCardItem[] = recents
    .map<ContextCardItem>((p) => ({
      id: p.id,
      title: p.text || 'Untitled',
      kind: 'page' as const,
      badge: 'notion',
      onOpen: () => setOpenContextId(p.id),
      onRemove: () => void removeContextPage(p.id, projectId),
      removeLabel: 'Remove page from this project'
    }))
    .concat(
      chats.map((c) => ({
        id: c.id,
        title: c.name || 'Untitled',
        kind: 'chat' as const,
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
        kind: 'person' as const,
        badge: 'user',
        onOpen: () => onOpenPerson?.(person.id),
        onRemove: () => void detachPerson(person.id),
        removeLabel: 'Remove person from this project'
      }))
    )

  const folderOf = folderByItemId(folders)
  /* Chats and people are the project's wherever they are filed, so they are looked up by id when a
     folder is opened. Pages are not: a folder's pages live inside the folder page in Notion and are
     never among the project's own. */
  /* Keyed the way `folderByItemId` keys its side: an id read out of a link block has had its dashes
     stripped, and a block id has not. */
  const byId = new Map(allItems.map((item) => [normalizeNotionId(item.id), item]))

  /** What a folder holds: the pages it links to, then the chats and people it links to. Every kind
      is filed the same way now, so every kind unfiles the same way — a page's remove button takes it
      back out to the project's top level, exactly as a chat's does. */
  const folderContents = (folder: ContextFolder): ContextCardItem[] => {
    const pages: ContextCardItem[] = folder.pages.map<ContextCardItem>((page) => ({
      id: page.id,
      title: page.title || 'Untitled',
      kind: 'page' as const,
      badge: 'notion',
      onOpen: () => setOpenContextId(page.id),
      onRemove: () => void unfile(page.id, folder.id),
      removeLabel: 'Remove from this folder'
    }))

    return pages.concat(
      folder.items
        .map((id) => byId.get(normalizeNotionId(id)))
        .filter((item): item is ContextCardItem => item !== undefined)
        .map((item) => ({
          ...item,
          onRemove: () => void unfile(item.id, folder.id),
          removeLabel: 'Remove from this folder'
        }))
    )
  }

  const folderCards: ContextCardItem[] = folders.map<ContextCardItem>((folder) => {
    const count = folder.pages.length + folder.items.filter((id) => byId.has(normalizeNotionId(id))).length
    return {
      id: folder.id,
      title: folder.name || 'Untitled',
      subtitle: count === 1 ? '1 item' : `${count} items`,
      /* Filled when it holds something, outlined when it does not, so a glance across the panel
         says which folders have anything in them without reading the counts. */
      kind: 'folder' as const,
      badge: count > 0 ? 'folder-filled' : 'folder',
      onOpen: () => setOpenFolderId(folder.id),
      onRename: (name: string) => void renameFolder(folder.id, name),
      onRemove: () => void deleteFolder(folder.id),
      /* Nothing filed in a folder is inside it any more — pages, chats and people are all linked
         from it — so deleting one takes nothing down with it. What it held stops being in the
         project, and the pages are still in the Pages table. */
      removeLabel: 'Delete folder'
    }
  })

  const contextItems: ContextCardItem[] = openFolder
    ? folderContents(openFolder)
    : folderCards.concat(allItems.filter((item) => !folderOf.has(normalizeNotionId(item.id))))

  /* The drag lives here rather than in a layout, so it survives crossing from one section to the
     next when the panel is split by kind. */
  const drag: ContextDrag = {
    id: dragging?.id ?? null,
    kind: dragging?.kind ?? null,
    overId: dropTarget,
    start: (id, kind) => setDragging({ id, kind }),
    over: setDropTarget,
    end: () => {
      setDragging(null)
      setDropTarget(null)
    }
  }

  /** The panel split into a section per kind, in the order the sidebar lists them. Empty sections
      are left out — a heading over nothing says the project has a kind of context it does not. */
  const groups: Array<{ kind: ContextItemKind; label: string; items: ContextCardItem[] }> = (
    [
      { kind: 'folder', label: 'Folders' },
      { kind: 'page', label: 'Pages' },
      { kind: 'chat', label: 'Chats' },
      { kind: 'person', label: 'People' }
    ] as const
  )
    .map((group) => ({ ...group, items: contextItems.filter((item) => item.kind === group.kind) }))
    /* Folders stay while one is being named: the card being typed into is in that section, and the
       section it is in cannot be the one that is missing. */
    .filter((group) => group.items.length > 0 || (group.kind === 'folder' && creatingFolder))

  /** Files a dragged item into a folder, which is the only thing a drag does: whatever was dropped
      stops being linked from the project and starts being linked from the folder. A page is no
      different from a chat here — it keeps its id, since nothing is copied any more.

      The card is moved in the panel first. The move is two requests long, and a card that sits where
      it was dropped from until they both come back reads as a drop that did not take. */
  async function fileByDrag(dragId: string, folderId: string): Promise<void> {
    const page = recents.find((p) => p.id === dragId)

    if (page) {
      setDetail((d) =>
        d
          ? {
              ...d,
              blocks: d.blocks.filter((b) => b.id !== dragId),
              folders: d.folders.map((f) =>
                f.id === folderId
                  ? { ...f, pages: f.pages.concat({ id: page.id, title: page.text }) }
                  : f
              )
            }
          : d
      )
    } else {
      /* A chat or a person only changes where it is recorded, so the card can move on the spot. */
      setDetail((d) =>
        d
          ? {
              ...d,
              folders: d.folders.map((f) =>
                f.id === folderId ? { ...f, items: f.items.concat(dragId) } : f
              )
            }
          : d
      )
    }

    try {
      if (page) await window.api.moveContextPage(dragId, projectId, folderId)
      else await fileInFolder(dragId, folderId)
    } catch (err) {
      console.error('[project] file into folder failed:', err)
    } finally {
      load()
    }
  }
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
          /* Made under the folder's page when one is open, which is the whole of filing it: a
             folder holds its pages in Notion rather than by reference. */
          const id = await window.api.createContextPage(openFolderId ?? projectId, newTitle, text)
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
        onSave={async (newTitle, text) => {
          if (newTitle !== (contextDetail?.title ?? '')) {
            await window.api.renameContextPage(openContextId, newTitle)
          }
          await window.api.updateContextPageContent(openContextId, text)
          loadContext(openContextId)
          /* The project holds the page's title too, on the card that opens it, so a rename has to
             reach the panel behind this view as well. */
          load()
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
                {/* Inside a folder the heading becomes the folder, with the way back out in front
                    of it: the panel is showing that folder's contents and nothing else, so calling
                    it "Context" would say the project had emptied. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
                  {openFolder ? (
                    <IconButton
                      icon="arrow-left"
                      label="Back to all context"
                      size="sm"
                      onClick={() => setOpenFolderId(null)}
                    />
                  ) : null}
                  <h3
                    style={{
                      ...headingStyle,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {openFolder ? openFolder.name || 'Untitled' : 'Context'}
                  </h3>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-4)',
                    flex: '0 0 auto'
                  }}
                >
                  {/* Reads as its own control rather than a third icon among the buttons: it does
                      not act on anything, it changes how what is already there is laid out. */}
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      font: 'var(--type-meta)',
                      color: 'var(--text-faint)',
                      letterSpacing: 'var(--tracking-tight)',
                      cursor: 'pointer',
                      userSelect: 'none'
                    }}
                  >
                    By type
                    <Switch
                      checked={grouped}
                      label="Split context by type"
                      onChange={(next) => {
                        setGrouped(next)
                        saveContextGrouping(next)
                      }}
                    />
                  </label>
                  <ContextViewToggle
                    view={contextView}
                    onChange={(next) => {
                      setContextView(next)
                      saveContextView(next)
                    }}
                  />
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
                        pages={attachablePages}
                        onAttach={(picks) => {
                          setAddAnchor(null)
                          void attachMany(picks)
                        }}
                        onNew={() => {
                          setAddAnchor(null)
                          setCreatingContext(true)
                        }}
                        /* Only at the top level: a folder inside a folder would need a tree. */
                        onNewFolder={
                          openFolder
                            ? undefined
                            : () => {
                                setAddAnchor(null)
                                setCreatingFolder(true)
                              }
                        }
                        onClose={() => setAddAnchor(null)}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
              {loading ? (
                <ContextCardsSkeleton view={contextView} />
              ) : error ? (
                <span style={emptyStyle}>Couldn&apos;t load this project.</span>
              ) : contextItems.length === 0 && !creatingFolder ? null : grouped ? (
                groups.map((group, i) => (
                  <div key={group.kind}>
                    <SectionLabel flush={i === 0}>{group.label}</SectionLabel>
                    <ContextCards
                      items={group.items}
                      view={contextView}
                      drag={drag}
                      onFile={(dragId, folderId) => void fileByDrag(dragId, folderId)}
                      /* The card being named belongs to the section it will land in. */
                      newFolder={
                        creatingFolder && group.kind === 'folder'
                          ? { onCommit: createFolder, onCancel: () => setCreatingFolder(false) }
                          : undefined
                      }
                    />
                  </div>
                ))
              ) : (
                <ContextCards
                  items={contextItems}
                  view={contextView}
                  drag={drag}
                  onFile={(dragId, folderId) => void fileByDrag(dragId, folderId)}
                  newFolder={
                    creatingFolder
                      ? { onCommit: createFolder, onCancel: () => setCreatingFolder(false) }
                      : undefined
                  }
                />
              )}
            </div>
          </aside>
        </div>
      </div>
      </div>
    </main>
  )
}
