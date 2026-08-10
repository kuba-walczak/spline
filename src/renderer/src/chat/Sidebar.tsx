import { useState } from 'react'
import type { ReactElement } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { NavItem } from '@/components/ui/nav-item'
import { SectionLabel } from '@/components/ui/section-label'
import { SegmentedControl } from '@/components/ui/segmented-control'

/* Chat-window sidebar, after ui_kits/claude_desktop/Sidebar.jsx in the design
   system. Recents is driven by the session's in-memory conversations. */

export interface SidebarConversation {
  id: number
  title: string
}

export interface SidebarProps {
  conversations: SidebarConversation[]
  activeId: number | null
  onSelect: (id: number) => void
  onNew: () => void
}

export function Sidebar({ conversations, activeId, onSelect, onNew }: SidebarProps): ReactElement {
  const [tab, setTab] = useState('home')

  return (
    <aside
      style={{
        width: 'var(--sidebar-width)',
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
      <div style={{ padding: '0 var(--sidebar-inset) 12px' }}>
        <SegmentedControl
          fill
          value={tab}
          onChange={setTab}
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
          padding: '0 var(--sidebar-inset) 12px',
          scrollbarWidth: 'thin'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--row-gap)' }}>
          <NavItem icon="plus" label="New" emphasis onClick={onNew} />
        </div>

        <SectionLabel action={<IconButton icon="plus" label="New chat" size="sm" onClick={onNew} />}>
          Chats
        </SectionLabel>
        {conversations.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--row-gap)' }}>
            {conversations.map((c) => (
              <NavItem
                key={c.id}
                icon="message-circle"
                label={c.title}
                active={c.id === activeId}
                onClick={() => onSelect(c.id)}
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
      </div>
    </aside>
  )
}
