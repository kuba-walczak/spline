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
  strokeWidth?: number
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
  strokeWidth,
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
        boxSizing: 'border-box',
        width: `${s.box}px`,
        height: `${s.box}px`,
        padding: 0,
        border: '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        lineHeight: 0,
        cursor: 'pointer',
        transition: 'var(--transition-control)',
        /* Ghost rest is #30302F at alpha 0, not `transparent` — that keyword is black at alpha 0,
           so the fade would interpolate through a dark flash instead of just appearing. */
        background:
          variant === 'filled'
            ? hovered || active
              ? 'var(--surface-control-hover)'
              : 'var(--surface-control)'
            : hovered || active
              ? '#30302F'
              : '#30302F00',
        color: 'var(--text-primary)',
        ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : null),
        ...style
      }}
    >
      {/* Dim the whole glyph, never its stroke: opacity on the <svg> composites the
          flattened shape once, so overlapping strokes don't show through each other. */}
      <Icon
        name={icon}
        size={glyphSize || s.glyph}
        strokeWidth={strokeWidth}
        style={{
          opacity: active || hovered ? 1 : 0.62,
          transition: `opacity var(--duration-fast) var(--ease-standard)`
        }}
      />
    </button>
  )
}
