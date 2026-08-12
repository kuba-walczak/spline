import { useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Badge } from './badge'

export interface CardProps {
  title: string
  badge?: string
  body?: string
  meta?: string
  onClick?: () => void
  className?: string
  style?: CSSProperties
}

export function Card({ title, badge, body, meta, onClick, className, style }: CardProps): ReactElement {
  const [hover, setHover] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        gap: 'var(--space-4)',
        width: '100%',
        boxSizing: 'border-box',
        padding: 'var(--space-8)',
        textAlign: 'left',
        background: hover ? 'var(--surface-hover)' : 'var(--surface-subtle)',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        cursor: 'pointer',
        transition: 'var(--transition-control)',
        ...style
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 0 }}>
        <span
          style={{
            font: 'var(--type-body-strong)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-primary)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {title}
        </span>
        {badge ? <Badge>{badge}</Badge> : null}
      </div>

      {body ? (
        <span
          style={{
            font: 'var(--type-body)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-muted)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {body}
        </span>
      ) : null}

      {meta ? (
        <span
          style={{
            marginTop: 'auto',
            font: 'var(--type-meta)',
            letterSpacing: 'var(--tracking-tight)',
            color: 'var(--text-faint)'
          }}
        >
          {meta}
        </span>
      ) : null}
    </button>
  )
}
