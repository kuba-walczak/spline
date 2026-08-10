import type { CSSProperties, ReactElement } from 'react'

export interface AvatarProps {
  size?: number
  initials?: string
  src?: string
  name?: string
  background?: string
  className?: string
  style?: CSSProperties
}

export function Avatar({ size = 22, initials, src, name, background, className, style }: AvatarProps): ReactElement {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: 'var(--radius-full)',
        background: background || 'var(--surface-hover)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)',
        fontSize: `${Math.max(9, Math.round(size * 0.45))}px`,
        fontWeight: 'var(--weight-semibold)',
        letterSpacing: '0.01em',
        lineHeight: 1,
        textTransform: 'uppercase',
        overflow: 'hidden',
        userSelect: 'none',
        ...style
      }}
    >
      {src ? (
        <img src={src} alt={name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        initials
      )}
    </span>
  )
}
