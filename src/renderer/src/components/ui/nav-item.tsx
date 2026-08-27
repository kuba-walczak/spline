import { useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Badge } from './badge'
import { Icon } from './icon'
import type { IconName } from './icon'

export interface NavItemProps {
  icon?: IconName
  /** Replaces the icon glyph in the leading slot — used for the chats' status dot. */
  leading?: ReactNode
  label: string
  active?: boolean
  emphasis?: boolean
  badge?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  className?: string
  style?: CSSProperties
}

export function NavItem({
  icon,
  leading,
  label,
  active = false,
  emphasis,
  badge,
  trailing,
  onClick,
  className,
  style
}: NavItemProps): ReactElement {
  const [hover, setHover] = useState(false)
  const background = active ? 'var(--surface-selected)' : hover ? 'var(--surface-hover)' : 'transparent'

  const glyph = emphasis ? (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '18px',
        height: '18px',
        flex: '0 0 auto',
        borderRadius: 'var(--radius-full)',
        background: 'var(--surface-app)',
        color: 'var(--text-primary)',
        marginLeft: '-1px'
      }}
    >
      <Icon name={icon as IconName} size={12} strokeWidth={2} />
    </span>
  ) : (
    <span
      style={{
        display: 'inline-flex',
        width: '16px',
        justifyContent: 'center',
        flex: '0 0 auto',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)'
      }}
    >
      <Icon name={icon as IconName} size={16} />
    </span>
  )

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '9px',
        width: '100%',
        height: 'var(--row-height)',
        padding: '0 8px',
        boxSizing: 'border-box',
        background,
        border: '1px solid transparent',
        borderRadius: 'var(--radius-sm)',
        color: active ? 'var(--text-primary)' : 'var(--text-body)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base)',
        fontWeight: active ? 'var(--weight-medium)' : 'var(--weight-regular)',
        letterSpacing: 'var(--tracking-tight)',
        lineHeight: 1,
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'var(--transition-control)',
        ...style
      }}
    >
      {leading ?? (icon ? glyph : null)}
      <span style={{ flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {badge ? <Badge variant="bare">{badge}</Badge> : null}
      {trailing || null}
    </button>
  )
}
