import { useState } from 'react'
import type { ReactElement } from 'react'
import { DeviceDebug } from './DeviceDebug'
import { IconButton } from '@/components/ui/icon-button'
import { NavItem } from '@/components/ui/nav-item'
import { SectionLabel } from '@/components/ui/section-label'
import { SegmentedControl } from '@/components/ui/segmented-control'

/* Chat-window sidebar, after ui_kits/claude_desktop/Sidebar.jsx in the design
   system. Recents is driven by the session's in-memory conversations. */

export interface SidebarConversation {
  id: number
  title: string
  colors?: string[]
  /** Lifecycle of this chat's CLI process, shown as the row's leading dot. */
  status?: SessionStatus
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

/** Right-to-left tint: one color fades to transparent, several are spread as stops before the fade. */
function tintGradient(colors: string[]): string | undefined {
  if (colors.length === 0) return undefined
  if (colors.length === 1) return `linear-gradient(to right, ${colors[0]}, transparent)`
  return `linear-gradient(to right, ${colors.join(', ')}, transparent)`
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

interface ChatRowProps {
  conversation: SidebarConversation
  active: boolean
  onSelect: () => void
  onDelete: () => void
}

function ChatRow({ conversation, active, onSelect, onDelete }: ChatRowProps): ReactElement {
  const [hover, setHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <NavItem
        leading={<StatusDot status={conversation.status ?? 'idle'} />}
        label={conversation.title}
        active={active}
        onClick={onSelect}
      />
      {conversation.colors && conversation.colors.length > 0 ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'var(--radius-sm)',
            background: tintGradient(conversation.colors),
            mixBlendMode: 'screen',
            pointerEvents: 'none'
          }}
        />
      ) : null}
      {hover || menuOpen ? (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            right: 4,
            transform: 'translateY(-50%)'
          }}
        >
          <IconButton
            icon="ellipsis-vertical"
            label="Chat options"
            size="sm"
            active={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
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
                  <div key={p.id} style={{ position: 'relative' }}>
                    <NavItem
                      icon="folder"
                      label={p.title}
                      active={p.id === activeProjectId}
                      onClick={() => onSelectProject(p.id)}
                    />
                    {p.color ? (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          borderRadius: 'var(--radius-sm)',
                          background: `linear-gradient(to right, ${p.color}, transparent)`,
                          mixBlendMode: 'screen',
                          pointerEvents: 'none'
                        }}
                      />
                    ) : null}
                  </div>
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
