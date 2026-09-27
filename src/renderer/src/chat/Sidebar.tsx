import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { DeviceDebug } from './DeviceDebug'
import { parseAffiliations, serializeAffiliations } from '@shared/affiliations'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { NavItem } from '@/components/ui/nav-item'
import { relativeTime } from '@/lib/relativeTime'
import { SectionLabel } from '@/components/ui/section-label'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { loadSectionGrouping, saveSectionGrouping } from '@/lib/contextView'
import type { GroupableSection } from '@/lib/contextView'

/* Chat-window sidebar, after ui_kits/claude_desktop/Sidebar.jsx in the design
   system. Recents is driven by the session's in-memory conversations. */

export interface SidebarConversation {
  id: number
  title: string
  /** Projects attached to this chat, shown as one folder each to the left of the title. */
  projects?: SidebarProject[]
  /** Lifecycle of this chat's CLI process, shown as the row's leading dot. */
  status?: SessionStatus
  /** ISO timestamp of the chat's last message, rendered as "5 minutes ago" while the row is idle. */
  lastActive?: string | null
  /** True while the chat keeps the name it has — the automatic re-title after each message is off. */
  titleLocked?: boolean
}

export type SessionStatus = 'idle' | 'booting' | 'ready'

const STATUS_COLORS: Record<SessionStatus, string> = {
  idle: '#000000',
  booting: '#e0b341',
  ready: '#4caf7d'
}

const STATUS_LABELS: Record<SessionStatus, string> = {
  idle: 'No process running',
  booting: 'Starting up',
  ready: 'Online'
}

/** Occupies the same 16px leading slot the chat icon used, so rows stay aligned. */
function StatusDot({ status }: { status: SessionStatus }): ReactElement {
  return (
    <span
      title={STATUS_LABELS[status]}
      style={{
        display: 'inline-flex',
        width: '16px',
        justifyContent: 'center',
        alignItems: 'center',
        flex: '0 0 auto'
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: 'var(--radius-full)',
          background: STATUS_COLORS[status],
          boxShadow: status === 'idle' ? 'inset 0 0 0 1px var(--border-default)' : 'none',
          transition: 'var(--transition-control)'
        }}
      />
    </span>
  )
}

export interface SidebarProject {
  id: string
  title: string
  color: string | null
}

export interface SidebarPerson {
  id: string
  name: string
  /** What they are affiliated with, as the column holds it — several are comma-separated. Shown at
      the right of the row, where a chat shows its age. */
  affiliation?: string
  /** The projects this person is in, drawn as folder chips the way a chat row draws its own. */
  projects?: SidebarProject[]
}

export interface SidebarPage {
  id: string
  title: string
  /** The projects linking to this page — none for a loose one, several for a shared one. Drawn as
      folder chips, the same as a person's. */
  projects?: SidebarProject[]
}

export interface SidebarSkill {
  id: string
  name: string
}

export interface SidebarProps {
  conversations: SidebarConversation[]
  activeId: number | null
  onSelect: (id: number) => void
  onNew: () => void
  onDelete: (id: number) => void
  /** Renames a chat by hand. Does not lock it — a chat left unlocked is re-titled on its next send. */
  onRename: (id: number, title: string) => void
  onToggleTitleLock: (id: number) => void
  projects: SidebarProject[]
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  onNewProject: () => void
  onDeleteProject: (id: string) => void
  skills: SidebarSkill[]
  activeSkillId: string | null
  onSelectSkill: (id: string) => void
  onNewSkill: () => void
  onDeleteSkill: (id: string) => void
  people: SidebarPerson[]
  activePersonId: string | null
  onSelectPerson: (id: string) => void
  onNewPerson: () => void
  onDeletePerson: (id: string) => void
  pages: SidebarPage[]
  activePageId: string | null
  onSelectPage: (id: string) => void
  onNewPage: () => void
  onDeletePage: (id: string) => void
  /** Which top-level view the app is on. */
  route: string
  onNavigate: (route: string) => void
}

/** A project's folder: stroked in the project's colour, filled with the same colour at 80%.

    `color-mix` rather than an alpha suffix on the hex, so it works just as well for the
    `var(--text-muted)` fallback as for a project's own colour. The inline `fill` beats the
    `fill="none"` attribute lucide sets — presentation attributes lose to CSS.

    Sized and boxed to match NavItem's own leading glyph, so project rows and chat rows line up. */
function ProjectFolder({ color }: { color: string | null }): ReactElement {
  return (
    <span
      style={{
        display: 'inline-flex',
        width: '16px',
        justifyContent: 'center',
        flex: '0 0 auto',
        color: color ?? 'var(--text-muted)'
      }}
    >
      <Icon
        name="folder"
        size={16}
        strokeWidth={2.25}
        style={{ fill: 'color-mix(in srgb, currentColor 80%, transparent)' }}
      />
    </span>
  )
}

/** Hover and selected background for chat rows — deliberately quieter than the shared
    `--surface-hover` used by the nav items above them. */
const CHAT_ROW_HIGHLIGHT = '#232323'

/** Width the section selector needs before its labels stop fitting — four items, each an icon plus
    a word. Below it the selector shows icons alone.

    Measured rather than guessed: "Projects" is the widest and starts clipping around 320px, with
    everything comfortable by 360. Set above the clipping point rather than at it, since erring high
    only shows icons a little early, while erring low shows words cut mid-letter. */
const SECTION_LABEL_WIDTH = 345

/** A group's heading in a sidebar section: a chevron that folds the group shut, the project's
    folder chip, and its name. The whole heading is the control — a chevron alone is a small target,
    and there is nothing else on the row to click. */
function GroupHeading({
  label,
  color,
  folder = true,
  collapsed,
  onToggle
}: {
  label: string
  color: string | null
  /** Whether the heading carries a folder chip. The "No project" group is defined by not being a
      project, so a folder next to its name would name the one thing its rows do not have. */
  folder?: boolean
  collapsed: boolean
  onToggle: () => void
}): ReactElement {
  return (
    <SectionLabel style={{ marginTop: 'var(--space-5)' }}>
      <span
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onToggle()
          }
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          cursor: 'pointer',
          userSelect: 'none'
        }}
      >
        <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={14} />
        {folder ? <ProjectFolder color={color} /> : null}
        {label}
      </span>
    </SectionLabel>
  )
}

interface ManagedRowProps {
  /** The row's glyph. Projects pass `leading` instead, since their marker is a coloured folder. */
  icon?: string
  leading?: ReactNode
  label: string
  /** A quiet label at the right of the row — a person's affiliations. Yields to the options button
      on hover, the way a chat row's age does. */
  meta?: string
  active: boolean
  optionsLabel: string
  onSelect: () => void
  onDelete: () => void
}

/** One line of a row's options menu. The rows share a menu shape — a stack of plain left-aligned
    buttons on the popover's own surface — so the styling lives here rather than at each call site. */
function MenuItem({
  label,
  /** Undefined for a plain action. Set on an entry that is a toggle, and true while it is on —
      shown as a tick, so the entry reads the same whether it is on or off until you look right. */
  checked,
  onSelect
}: {
  label: string
  checked?: boolean
  onSelect: () => void
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'left',
        padding: '4px 8px',
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: '#E6E5E2',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base)',
        fontWeight: 'var(--weight-regular)',
        lineHeight: 'var(--leading-normal)',
        letterSpacing: 'var(--tracking-tight)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {checked ? <Icon name="check" size={13} /> : null}
    </button>
  )
}

/** The popover the options button opens: anchored under the row's right edge, over a click-catcher
    that closes it. */
function RowMenu({ onDismiss, children }: { onDismiss: () => void; children: ReactNode }): ReactElement {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={onDismiss} />
      <div
        style={{
          position: 'absolute',
          top: 'calc(var(--row-height) + 2px)',
          right: 4,
          zIndex: 11,
          minWidth: 140,
          /* Clears the corner radius the way the add-context menu's panel does — an even 4px is
             less than the 8px arc, and the first and last rows lost their gap to it. */
          padding: 'var(--space-3) var(--space-2)',
          background: '#20201F',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
        }}
      >
        {children}
      </div>
    </>
  )
}

/** The row's options control. Absolutely placed in the same 4px-inset square on every managed row,
    so the hover fill is centered in the row rather than sitting on the line box the icon would
    otherwise make as an inline button. */
function RowOptionsButton({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): ReactElement {
  return (
    <div
      style={{
        position: 'absolute',
        top: 4,
        bottom: 4,
        right: 4,
        width: 'calc(var(--row-height) - 8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 0
      }}
    >
      {/* Square, and inset from the row's edges by the same 4px on all four sides, so its
          highlight sits neatly inside the row's own rather than filling it edge to edge. */}
      <IconButton
        icon="ellipsis-vertical"
        label={label}
        size="sm"
        active={active}
        onClick={onClick}
        style={{
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
          border: 'none',
          /* Tighter than the button default: nested inside the row's own --radius-sm corners,
             an 8px radius on an 18px square reads almost circular. */
          borderRadius: 'var(--radius-xs)'
        }}
      />
    </div>
  )
}

/** A sidebar row that can be deleted. Carries the same options menu a chat row does — hidden until
    the row is hovered, so a list stays quiet until you reach for one. Shared by projects, skills
    and people, which differ only in their glyph. */
function ManagedRow({
  icon,
  leading,
  label,
  meta,
  active,
  optionsLabel,
  onSelect,
  onDelete
}: ManagedRowProps): ReactElement {
  const [hover, setHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <NavItem
        icon={icon}
        leading={leading}
        label={label}
        active={active}
        highlight={CHAT_ROW_HIGHLIGHT}
        hovered={hover || menuOpen}
        onClick={onSelect}
        /* Traded for a spacer on hover, exactly as a chat row trades its age: the label and the
           options button share this corner, and whichever can be clicked wins it. In the flex row
           rather than floating over it, so a long name is ellipsised by the label's own overflow
           rules instead of running underneath. */
        trailing={
          hover || menuOpen ? (
            <span
              style={{
                flex: '0 0 auto',
                width: 'calc(var(--row-height) - 4px)',
                marginLeft: '2px'
              }}
            />
          ) : meta ? (
            <span
              title={meta}
              style={{
                flex: '0 1 auto',
                minWidth: 0,
                maxWidth: '45%',
                marginLeft: '2px',
                font: 'var(--type-meta)',
                letterSpacing: 'var(--tracking-tight)',
                color: 'var(--text-faint)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {meta}
            </span>
          ) : null
        }
      />
      {hover || menuOpen ? (
        <RowOptionsButton
          label={optionsLabel}
          active={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        />
      ) : null}
      {menuOpen ? (
        <RowMenu onDismiss={() => setMenuOpen(false)}>
          <MenuItem
            label="Delete"
            onSelect={() => {
              setMenuOpen(false)
              onDelete()
            }}
          />
        </RowMenu>
      ) : null}
    </div>
  )
}

interface ChatRowProps {
  conversation: SidebarConversation
  active: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
  onToggleTitleLock: () => void
  onOpenProject: (id: string) => void
  /** False in a grouped list, where the heading above already says which project this is in. */
  showProjects?: boolean
}

function ChatRow({
  conversation,
  active,
  onSelect,
  onDelete,
  onRename,
  onToggleTitleLock,
  onOpenProject,
  showProjects = true
}: ChatRowProps): ReactElement {
  const [hover, setHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  /** Non-null while the row is being renamed in place, holding the text typed so far. */
  const [draft, setDraft] = useState<string | null>(null)

  /* Recomputed on every render rather than kept in state — the parent re-renders on its poll tick,
     which is what advances these labels. */
  const age = relativeTime(conversation.lastActive)

  /* Built once and used by both states of the row: the status dot and the project folders are facts
     about the chat, not decoration on the label, so renaming must not take them away. */
  const leading = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flex: '0 0 auto' }}>
      <StatusDot status={conversation.status ?? 'idle'} />
      {(showProjects ? conversation.projects ?? [] : []).map((project) => (
        /* A span rather than a button: this already sits inside NavItem's <button>, and
           nesting one inside another is invalid. Stopping propagation is what keeps the
           folder from also selecting the chat. */
        <span
          key={project.id}
          role="button"
          tabIndex={-1}
          title={`Open ${project.title}`}
          onClick={(event) => {
            event.stopPropagation()
            onOpenProject(project.id)
          }}
          style={{ display: 'inline-flex', flex: '0 0 auto', cursor: 'pointer' }}
        >
          <ProjectFolder color={project.color} />
        </span>
      ))}
    </span>
  )

  function commitRename(): void {
    const next = (draft ?? '').trim()
    setDraft(null)
    /* An empty box is a cancelled rename rather than a request for an empty title. */
    if (next && next !== conversation.title) onRename(next)
  }

  /* Renaming replaces the row rather than overlaying it, and reproduces NavItem's own geometry —
     same height, padding and gap — so nothing in the list moves and the name is edited exactly
     where it is read. */
  if (draft !== null) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '9px',
          width: '100%',
          height: 'var(--row-height)',
          padding: '0 8px',
          boxSizing: 'border-box',
          /* NavItem carries a transparent 1px border, which is part of where its content sits.
             Without the same border here the leading slot moves a pixel the moment the box opens. */
          border: '1px solid transparent',
          borderRadius: 'var(--radius-sm)'
        }}
      >
        {leading}
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            /* Escape drops the edit without touching the name — clearing the draft closes the box,
               so the blur that follows has nothing left to commit. */
            if (e.key === 'Escape') setDraft(null)
          }}
          style={{
            flex: '1 1 auto',
            minWidth: 0,
            height: '100%',
            padding: 0,
            background: 'transparent',
            /* No border, no ring, no tint: the box is the row, and the caret is the only sign the
               name is being edited. */
            border: 'none',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--text-base)',
            fontWeight: 'var(--weight-medium)',
            letterSpacing: 'var(--tracking-tight)',
            outline: 'none',
            /* Beats the global `*:focus-visible` ring in tokens.css, which would otherwise draw a
               pill around the row the moment the box takes focus. */
            boxShadow: 'none'
          }}
        />
      </div>
    )
  }

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <NavItem
        leading={leading}
        label={conversation.title}
        active={active}
        highlight={CHAT_ROW_HIGHLIGHT}
        hovered={hover || menuOpen}
        onClick={onSelect}
        /* In the flex row rather than floating over it, so a long title is squeezed and ellipsised
           by the label's own overflow rules instead of running underneath the age. On hover the age
           yields to a spacer the width of the options button — the title expands, but not under the
           button. */
        trailing={
          hover || menuOpen ? (
            <span
              style={{
                flex: '0 0 auto',
                width: 'calc(var(--row-height) - 4px)',
                marginLeft: '2px'
              }}
            />
          ) : age ? (
            <span
              style={{
                flex: '0 0 auto',
                marginLeft: '2px',
                font: 'var(--type-meta)',
                letterSpacing: 'var(--tracking-tight)',
                color: 'var(--text-faint)',
                whiteSpace: 'nowrap'
              }}
            >
              {age}
            </span>
          ) : null
        }
      />
      {/* The age and the options button occupy the same corner, so they trade places: the age is
          ambient information, and the moment there is something to click it gets out of the way. */}
      {hover || menuOpen ? (
        <RowOptionsButton
          label="Chat options"
          active={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        />
      ) : null}
      {menuOpen ? (
        <RowMenu onDismiss={() => setMenuOpen(false)}>
          <MenuItem
            label="Lock name"
            checked={conversation.titleLocked ?? false}
            onSelect={() => {
              setMenuOpen(false)
              onToggleTitleLock()
            }}
          />
          <MenuItem
            label="Rename"
            onSelect={() => {
              setMenuOpen(false)
              setHover(false)
              setDraft(conversation.title)
            }}
          />
          <MenuItem
            label="Delete"
            onSelect={() => {
              setMenuOpen(false)
              onDelete()
            }}
          />
        </RowMenu>
      ) : null}
    </div>
  )
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onToggleTitleLock,
  projects,
  activeProjectId,
  onSelectProject,
  onNewProject,
  onDeleteProject,
  skills,
  activeSkillId,
  onSelectSkill,
  onNewSkill,
  onDeleteSkill,
  people,
  activePersonId,
  onSelectPerson,
  onNewPerson,
  onDeletePerson,
  pages,
  activePageId,
  onSelectPage,
  onNewPage,
  onDeletePage,
  route,
  onNavigate
}: SidebarProps): ReactElement {
  const onProjects = route === 'projects' || route === 'project'
  const onSkills = route === 'skills' || route === 'skill'
  const onPeople = route === 'people' || route === 'person'
  const onPages = route === 'pages' || route === 'page'

  /* Whether the Pages and People lists are broken up by project. Per-machine and about reading, so
     they are remembered in localStorage rather than in Notion — the same reasoning as the context
     panel's own grouping switch. */
  const [chatsGrouped, setChatsGrouped] = useState(() => loadSectionGrouping('chats'))
  const [pagesGrouped, setPagesGrouped] = useState(() => loadSectionGrouping('pages'))
  const [peopleGrouped, setPeopleGrouped] = useState(() => loadSectionGrouping('people'))

  const groupSetters: Record<GroupableSection, (update: (on: boolean) => boolean) => void> = {
    chats: setChatsGrouped,
    pages: setPagesGrouped,
    people: setPeopleGrouped
  }

  function toggleGrouped(section: GroupableSection): void {
    groupSetters[section]((on) => {
      saveSectionGrouping(section, !on)
      return !on
    })
  }

  /** A section's rows as it draws them: one unlabelled group when flat, and otherwise a group per
      project, then Mixed, then No project.

      Every row is in exactly one group. Something linked from several projects goes to Mixed rather
      than being drawn once under each — a row that appears twice reads as two things, and the group
      it lands in is a fact about the row rather than about either project.

      Written once for both sections: a page and a person are grouped by the same rule, off the same
      `projects` field, and only their glyph and their labels differ. */
  function groupByProject<T extends { projects?: SidebarProject[] }>(
    rows: T[],
    grouped: boolean
  ): Array<{ key: string; label: string | null; color: string | null; items: T[] }> {
    if (!grouped) return [{ key: 'all', label: null, color: null, items: rows }]

    return projects
      .map((project) => ({
        key: project.id,
        label: project.title || 'Untitled',
        color: project.color,
        /* Only what this project alone holds — anything shared is in Mixed. */
        items: rows.filter(
          (row) => (row.projects ?? []).length === 1 && row.projects?.[0]?.id === project.id
        )
      }))
      .concat([
        {
          key: 'mixed',
          label: 'Mixed',
          color: null,
          items: rows.filter((row) => (row.projects ?? []).length > 1)
        },
        {
          key: 'loose',
          label: 'No project',
          color: null,
          items: rows.filter((row) => (row.projects ?? []).length === 0)
        }
      ])
      /* A group with nothing in it is a heading promising rows that never come. */
      .filter((group) => group.items.length > 0)
  }

  const chatGroups = groupByProject(conversations, chatsGrouped)
  const pageGroups = groupByProject(pages, pagesGrouped)
  const peopleGroups = groupByProject(people, peopleGrouped)

  /* Which groups are folded shut, keyed by section and group so the two sections cannot collapse
     each other's. Kept in memory rather than stored: a fold is about the moment you are in, and a
     group that came back shut after a restart would hide rows you had forgotten you hid. */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const isCollapsed = (key: string): boolean => collapsed[key] ?? false

  function toggleCollapsed(key: string): void {
    setCollapsed((current) => ({ ...current, [key]: !(current[key] ?? false) }))
  }

  /* The section selector is five items wide now, and the sidebar is resizable — below the width
     where the labels fit, they are dropped rather than clipped mid-word. Measured rather than
     assumed, because the threshold depends on the rendered font. */
  const navRef = useRef<HTMLDivElement | null>(null)
  const [iconsOnly, setIconsOnly] = useState(false)

  useEffect(() => {
    const el = navRef.current
    if (!el) return

    const observer = new ResizeObserver(([entry]) => setIconsOnly(entry.contentRect.width < SECTION_LABEL_WIDTH))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const section = onProjects
    ? 'projects'
    : onSkills
      ? 'skills'
      : onPeople
        ? 'people'
        : onPages
          ? 'pages'
          : 'chats'

  return (
    <aside
      style={{
        width: '100%',
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-sidebar)',
        height: '100%',
        overflow: 'hidden',
        paddingTop: 12,
        boxSizing: 'border-box',
        minHeight: 0
      }}
    >
      <div ref={navRef} style={{ padding: '0 10px 12px' }}>
        <SegmentedControl
          fill
          filledIcon
          iconsOnly={iconsOnly}
          value={section}
          onChange={onNavigate}
          items={[
            { value: 'chats', label: 'Chats', icon: 'message-circle' },
            { value: 'projects', label: 'Projects', icon: 'folder' },
            { value: 'pages', label: 'Pages', icon: 'file-text' },
            { value: 'people', label: 'People', icon: 'users' },
            { value: 'skills', label: 'Skills', icon: 'blocks' }
          ]}
        />
      </div>

      <div
        className="chatscroll"
        style={{
          flex: '1 1 auto',
          overflowY: 'auto',
          overflowX: 'hidden',
          scrollbarWidth: 'thin'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--row-gap)' }}>
          {onProjects ? (
            <NavItem icon="plus" label="New project" emphasis onClick={onNewProject} />
          ) : onSkills ? (
            <NavItem icon="plus" label="New skill" emphasis onClick={onNewSkill} />
          ) : onPeople ? (
            <NavItem icon="plus" label="New person" emphasis onClick={onNewPerson} />
          ) : onPages ? (
            <NavItem icon="plus" label="New page" emphasis onClick={onNewPage} />
          ) : (
            <NavItem icon="plus" label="New chat" emphasis onClick={onNew} />
          )}
        </div>

        {onProjects ? (
          <>
            <SectionLabel action={<IconButton icon="plus" label="New project" size="sm" onClick={onNewProject} />}>
              Projects
            </SectionLabel>
            {projects.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--row-gap)' }}>
                {projects.map((p) => (
                  <ManagedRow
                    key={p.id}
                    leading={<ProjectFolder color={p.color} />}
                    label={p.title}
                    active={p.id === activeProjectId}
                    optionsLabel="Project options"
                    onSelect={() => onSelectProject(p.id)}
                    onDelete={() => onDeleteProject(p.id)}
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: '2px 14px',
                  font: 'var(--type-meta)',
                  letterSpacing: 'var(--tracking-tight)',
                  color: 'var(--text-faint)'
                }}
              >
                No projects yet
              </div>
            )}
          </>
        ) : onPeople ? (
          <>
            <SectionLabel
              action={
                /* Grouping rather than creating: a new person is already one click away, on the
                   emphasised row at the top of the section. */
                <IconButton
                  icon="folder"
                  label={peopleGrouped ? 'List people flat' : 'Group people by project'}
                  size="sm"
                  active={peopleGrouped}
                  onClick={() => toggleGrouped('people')}
                />
              }
            >
              People
            </SectionLabel>
            {people.length > 0 ? (
              peopleGroups.map((group) => (
                <div key={group.key}>
                  {group.label === null ? null : (
                    <GroupHeading
                      label={group.label}
                      color={group.color}
                      folder={group.key !== 'loose'}
                      collapsed={isCollapsed(`people:${group.key}`)}
                      onToggle={() => toggleCollapsed(`people:${group.key}`)}
                    />
                  )}
                  {isCollapsed(`people:${group.key}`) ? null : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--row-gap)' }}>
                    {group.items.map((person) => (
                      <ManagedRow
                        key={person.id}
                        /* `leading` rather than `icon`, so the glyph and the project chips sit in
                           one row — the same arrangement a chat's status dot and folders make. The
                           chips go when the list is grouped, where the heading above already says
                           it — except under Mixed, whose heading says only that there are several,
                           and the chips say which. */
                        leading={
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flex: '0 0 auto' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                width: '16px',
                                justifyContent: 'center',
                                flex: '0 0 auto',
                                color: person.id === activePersonId ? 'var(--text-primary)' : 'var(--text-muted)'
                              }}
                            >
                              <Icon name="user" size={16} />
                            </span>
                            {(peopleGrouped && group.key !== 'mixed' ? [] : person.projects ?? []).map((project) => (
                              /* A span rather than a button, and the click stopped: this sits inside
                                 NavItem's own button, and the chip opens the project instead of the
                                 person. Same as the chat rows. */
                              <span
                                key={project.id}
                                role="button"
                                tabIndex={-1}
                                title={`Open ${project.title}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onSelectProject(project.id)
                                }}
                                style={{ display: 'inline-flex', flex: '0 0 auto', cursor: 'pointer' }}
                              >
                                <ProjectFolder color={project.color} />
                              </span>
                            ))}
                          </span>
                        }
                        label={person.name || 'Untitled'}
                        meta={serializeAffiliations(parseAffiliations(person.affiliation ?? ''))}
                        active={person.id === activePersonId}
                        optionsLabel="Person options"
                        onSelect={() => onSelectPerson(person.id)}
                        onDelete={() => onDeletePerson(person.id)}
                      />
                    ))}
                  </div>
                  )}
                </div>
              ))
            ) : (
              <div
                style={{
                  padding: '2px 14px',
                  font: 'var(--type-meta)',
                  letterSpacing: 'var(--tracking-tight)',
                  color: 'var(--text-faint)'
                }}
              >
                No people yet
              </div>
            )}
          </>
        ) : onPages ? (
          <>
            <SectionLabel
              action={
                /* Grouping rather than creating: a new page is already one click away, on the
                   emphasised row at the top of the section. */
                <IconButton
                  icon="folder"
                  label={pagesGrouped ? 'List pages flat' : 'Group pages by project'}
                  size="sm"
                  active={pagesGrouped}
                  onClick={() => toggleGrouped('pages')}
                />
              }
            >
              Pages
            </SectionLabel>
            {pages.length > 0 ? (
              pageGroups.map((group) => (
                <div key={group.key}>
                  {group.label === null ? null : (
                    <GroupHeading
                      label={group.label}
                      color={group.color}
                      folder={group.key !== 'loose'}
                      collapsed={isCollapsed(`pages:${group.key}`)}
                      onToggle={() => toggleCollapsed(`pages:${group.key}`)}
                    />
                  )}
                  {isCollapsed(`pages:${group.key}`) ? null : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--row-gap)' }}>
                    {group.items.map((page) => (
                      <ManagedRow
                        key={page.id}
                        /* Laid out like a person's row: the glyph and the project chips in one line,
                           so a page says at a glance which projects hold it — or that none do. The
                           chips go when the list is grouped, where the heading above already says
                           it and every row would otherwise repeat it — except under Mixed, whose
                           heading says only that there are several, and the chips say which. */
                        leading={
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flex: '0 0 auto' }}>
                            <span
                              style={{
                                display: 'inline-flex',
                                width: '16px',
                                justifyContent: 'center',
                                flex: '0 0 auto',
                                color: page.id === activePageId ? 'var(--text-primary)' : 'var(--text-muted)'
                              }}
                            >
                              <Icon name="file-text" size={16} />
                            </span>
                            {(pagesGrouped && group.key !== 'mixed' ? [] : page.projects ?? []).map((project) => (
                              <span
                                key={project.id}
                                role="button"
                                tabIndex={-1}
                                title={`Open ${project.title}`}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onSelectProject(project.id)
                                }}
                                style={{ display: 'inline-flex', flex: '0 0 auto', cursor: 'pointer' }}
                              >
                                <ProjectFolder color={project.color} />
                              </span>
                            ))}
                          </span>
                        }
                        label={page.title || 'Untitled'}
                        active={page.id === activePageId}
                        optionsLabel="Page options"
                        onSelect={() => onSelectPage(page.id)}
                        onDelete={() => onDeletePage(page.id)}
                      />
                    ))}
                  </div>
                  )}
                </div>
              ))
            ) : (
              <div
                style={{
                  padding: '2px 14px',
                  font: 'var(--type-meta)',
                  letterSpacing: 'var(--tracking-tight)',
                  color: 'var(--text-faint)'
                }}
              >
                No pages yet
              </div>
            )}
          </>
        ) : onSkills ? (
          <>
            <SectionLabel action={<IconButton icon="plus" label="New skill" size="sm" onClick={onNewSkill} />}>
              Skills
            </SectionLabel>
            {skills.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--row-gap)' }}>
                {skills.map((skill) => (
                  <ManagedRow
                    key={skill.id}
                    /* One glyph for every skill: the mode is a property of the skill, edited in its
                       own view, not something the list is for. */
                    icon="blocks"
                    label={skill.name || 'Untitled'}
                    active={skill.id === activeSkillId}
                    optionsLabel="Skill options"
                    onSelect={() => onSelectSkill(skill.id)}
                    onDelete={() => onDeleteSkill(skill.id)}
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: '2px 14px',
                  font: 'var(--type-meta)',
                  letterSpacing: 'var(--tracking-tight)',
                  color: 'var(--text-faint)'
                }}
              >
                No skills yet
              </div>
            )}
          </>
        ) : (
          <>
            <SectionLabel
              action={
                /* Grouping rather than creating: a new chat is already one click away, on the
                   emphasised row at the top of the section. */
                <IconButton
                  icon="folder"
                  label={chatsGrouped ? 'List chats flat' : 'Group chats by project'}
                  size="sm"
                  active={chatsGrouped}
                  onClick={() => toggleGrouped('chats')}
                />
              }
            >
              Chats
            </SectionLabel>
            {conversations.length > 0 ? (
              chatGroups.map((group) => (
                <div key={group.key}>
                  {group.label === null ? null : (
                    <GroupHeading
                      label={group.label}
                      color={group.color}
                      folder={group.key !== 'loose'}
                      collapsed={isCollapsed(`chats:${group.key}`)}
                      onToggle={() => toggleCollapsed(`chats:${group.key}`)}
                    />
                  )}
                  {isCollapsed(`chats:${group.key}`) ? null : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--row-gap)'}}>
                    {group.items.map((c) => (
                      <ChatRow
                        key={c.id}
                        conversation={c}
                        active={c.id === activeId}
                        onSelect={() => onSelect(c.id)}
                        onDelete={() => onDelete(c.id)}
                        onRename={(title) => onRename(c.id, title)}
                        onToggleTitleLock={() => onToggleTitleLock(c.id)}
                        onOpenProject={onSelectProject}
                        /* Chips stay under Mixed, whose heading says only that there are several. */
                        showProjects={!chatsGrouped || group.key === 'mixed'}
                      />
                    ))}
                  </div>
                  )}
                </div>
              ))
            ) : (
              <div
                style={{
                  padding: '2px 14px',
                  font: 'var(--type-meta)',
                  letterSpacing: 'var(--tracking-tight)',
                  color: 'var(--text-faint)'
                }}
              >
                No conversations yet
              </div>
            )}
          </>
        )}
      </div>

      <DeviceDebug />
    </aside>
  )
}
