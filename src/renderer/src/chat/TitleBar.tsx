import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'
import type { IconName } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'

/* Window title bar for the chat window. The window is frameless
   (titleBarStyle: 'hidden'), so this row carries the drag region. */

const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties
const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties

export interface TitleBarProps {
  /** Leading glyph shown next to the title. */
  icon?: IconName
  title?: string
  /** Dim the title — used for the empty "No conversation" state. */
  muted?: boolean
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  /** Trailing controls, right-aligned. */
  action?: ReactNode
}

export function TitleBar({
  icon,
  title,
  muted,
  sidebarCollapsed,
  onToggleSidebar,
  action
}: TitleBarProps): ReactElement {
  return (
    <header
      style={{
        flex: '0 0 auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        height: '52px',
        /* Right inset clears the native window-control overlay when there is one. */
        padding: '0 calc(100vw - env(titlebar-area-width, 100vw) + 16px) 0 12px',
        ...dragStyle
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minWidth: 0 }}>
        <div style={noDragStyle}>
          <IconButton
            icon="panel-left"
            label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            onClick={onToggleSidebar}
          />
        </div>
        {icon ? <Icon name={icon} size={16} /> : null}
        {title ? (
          <span
            style={{
              font: 'var(--weight-medium) var(--text-base)/1.2 var(--font-sans)',
              letterSpacing: 'var(--tracking-tight)',
              color: muted ? 'var(--text-faint)' : 'var(--text-primary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {title}
          </span>
        ) : null}
      </div>
      {action ? <div style={noDragStyle}>{action}</div> : null}
    </header>
  )
}
