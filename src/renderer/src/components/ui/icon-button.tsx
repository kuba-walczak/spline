import { useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Icon } from './icon'
import type { IconName } from './icon'

const SIZES = {
  sm: { box: 26, glyph: 14 },
  md: { box: 32, glyph: 16 }
} as const

export interface IconButtonProps {
  icon: IconName
  label: string
  size?: keyof typeof SIZES
  variant?: 'ghost' | 'filled'
  glyphSize?: number
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  className?: string
  style?: CSSProperties
}

export function IconButton({
  icon,
  label,
  size = 'md',
  variant = 'ghost',
  glyphSize,
  active,
  disabled,
  onClick,
  className,
  style
}: IconButtonProps): ReactElement {
  const s = SIZES[size]
  const [hover, setHover] = useState(false)
  const hovered = hover && !disabled

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${s.box}px`,
        height: `${s.box}px`,
        padding: 0,
        border: '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        cursor: 'pointer',
        transition: 'var(--transition-control)',
        background: variant === 'filled' ? 'var(--surface-control)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        ...(hovered
          ? {
              background: variant === 'filled' ? 'var(--surface-control-hover)' : 'var(--surface-hover)',
              color: 'var(--text-primary)'
            }
          : null),
        ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : null),
        ...style
      }}
    >
      <Icon name={icon} size={glyphSize || s.glyph} />
    </button>
  )
}
