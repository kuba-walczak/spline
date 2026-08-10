import { useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Icon } from './icon'

export interface DropdownButtonProps {
  value: string
  label?: string
  detail?: string
  variant?: 'filled' | 'bare'
  onClick?: () => void
  className?: string
  style?: CSSProperties
}

export function DropdownButton({
  value,
  label,
  detail,
  variant = 'filled',
  onClick,
  className,
  style
}: DropdownButtonProps): ReactElement {
  const [hover, setHover] = useState(false)
  const filled = variant === 'filled'
  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: filled ? '32px' : 'auto',
        padding: filled ? '0 12px' : '0',
        background: filled ? (hover ? 'var(--surface-control-hover)' : 'var(--surface-control)') : 'transparent',
        border: '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base)',
        letterSpacing: 'var(--tracking-tight)',
        lineHeight: 1,
        cursor: 'pointer',
        transition: 'var(--transition-control)',
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      {label ? <span style={{ color: 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>{label}</span> : null}
      <span style={{ color: 'var(--text-primary)', fontWeight: 'var(--weight-semibold)' }}>{value}</span>
      {detail ? (
        <span style={{ color: hover ? 'var(--text-body)' : 'var(--text-muted)', fontWeight: 'var(--weight-regular)' }}>
          {detail}
        </span>
      ) : null}
      <Icon name="chevron-down" size={14} style={{ color: 'var(--text-muted)' }} />
    </button>
  )
}
