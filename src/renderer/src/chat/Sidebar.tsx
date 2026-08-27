import { useState } from 'react'
import type { ReactElement } from 'react'
import { DeviceDebug } from './DeviceDebug'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { NavItem } from '@/components/ui/nav-item'
import { relativeTime } from '@/lib/relativeTime'
import { SectionLabel } from '@/components/ui/section-label'
import { SegmentedControl } from '@/components/ui/segmented-control'

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

export interface SidebarProps {
  conversations: SidebarConversation[]
  activeId: number | null
  onSelect: (id: number) => void
  onNew: () => void
  onDelete: (id: number) => void
  projects: SidebarProject[]
  activeProjectId: string | null
  onSelectProject: (id: string) => void
  onNewProject: () => void
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

interface ChatRowProps {
  conversation: SidebarConversation
  active: boolean
  onSelect: () => void
  onDelete: () => void
  onOpenProject: (id: string) => void
}

function ChatRow({ conversation, active, onSelect, onDelete, onOpenProject }: ChatRowProps): ReactElement {
  const [hover, setHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  /* Recomputed on every render rather than kept in state — the parent re-renders on its poll tick,
     which is what advances these labels. */
  const age = relativeTime(conversation.lastActive)

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <NavItem
        leading={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', flex: '0 0 auto' }}>
            <StatusDot status={conversation.status ?? 'idle'} />
            {(conversation.projects ?? []).map((project) => (
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
        }
        label={conversation.title}
        active={active}
        highlight={CHAT_ROW_HIGHLIGHT}
        hovered={hover || menuOpen}
        onClick={onSelect}
        /* In the flex row rather than floating over it, so a long title is squeezed and ellipsised
           by the label's own overflow rules instead of running underneath the age. */
        trailing={
          !hover && !menuOpen && age ? (
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
        <div
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            right: 4
          }}
        >
          {/* Square, and inset from the row's edges by the same 4px on all four sides, so its
              highlight sits neatly inside the row's own rather than filling it edge to edge. */}
          <IconButton
            icon="ellipsis-vertical"
            label="Chat options"
            size="sm"
            active={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              width: 'calc(var(--row-height) - 8px)',
              height: 'calc(var(--row-height) - 8px)',
              /* Tighter than the button default: nested inside the row's own --radius-sm corners,
                 an 8px radius on an 18px square reads almost circular. */
              borderRadius: 'var(--radius-xs)'
            }}
          />
        </div>
      ) : null}
      {menuOpen ? (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 10 }}
            onClick={() => setMenuOpen(false)}
          />
          <div
            style={{
              position: 'absolute',
              top: 'calc(var(--row-height) + 2px)',
              right: 4,
              zIndex: 11,
              minWidth: 140,
              padding: 'var(--space-2)',
              background: '#20201F',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
            }}
          >
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
              style={{
                display: 'block',
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
              Delete
            </button>
          </div>
        </>
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
  projects,
  activeProjectId,
  onSelectProject,
  onNewProject,
  route,
  onNavigate
}: SidebarProps): ReactElement {
  const onProjects = route === 'projects' || route === 'project'

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
      <div style={{ padding: '0 10px 12px' }}>
        <SegmentedControl
          fill
          value={onProjects ? 'projects' : route}
          onChange={onNavigate}
          items={[
            { value: 'home', label: 'Home', icon: 'house' },
            { value: 'projects', label: 'Projects', icon: 'folder' }
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
          ) : (
            <NavItem icon="plus" label="New" emphasis onClick={onNew} />
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
                  <NavItem
                    key={p.id}
                    leading={<ProjectFolder color={p.color} />}
                    label={p.title}
                    active={p.id === activeProjectId}
                    onClick={() => onSelectProject(p.id)}
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
        ) : (
          <>
            <SectionLabel action={<IconButton icon="plus" label="New chat" size="sm" onClick={onNew} />}>
              Chats
            </SectionLabel>
            {conversations.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--row-gap)'}}>
                {conversations.map((c) => (
                  <ChatRow
                    key={c.id}
                    conversation={c}
                    active={c.id === activeId}
                    onSelect={() => onSelect(c.id)}
                    onDelete={() => onDelete(c.id)}
                    onOpenProject={onSelectProject}
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
