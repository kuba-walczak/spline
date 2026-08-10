import type { CSSProperties, ReactElement, ReactNode } from 'react'

export interface BadgeProps {
  variant?: 'subtle' | 'bare'
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

export function Badge({ variant = 'subtle', children, className, style }: BadgeProps): ReactElement {
  const bare = variant === 'bare'
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flex: '0 0 auto',
        height: bare ? 'auto' : '20px',
        padding: bare ? '0' : '0 6px',
        background: bare ? 'transparent' : 'var(--surface-subtle)',
        borderRadius: 'var(--radius-sm)',
        color: bare ? 'var(--text-muted)' : 'var(--text-body)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-medium)',
        letterSpacing: 'var(--tracking-tight)',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        ...style
      }}
    >
      {children}
    </span>
  )
}
