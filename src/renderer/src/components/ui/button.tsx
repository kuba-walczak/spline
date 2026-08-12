import { useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { Icon } from './icon'
import type { IconName } from './icon'

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost'
  icon?: IconName
  disabled?: boolean
  onClick?: () => void
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

const FILL = {
  primary: { rest: 'var(--accent)', hover: 'var(--accent-hover)', text: '#ffffff' },
  secondary: { rest: 'var(--surface-control)', hover: 'var(--surface-control-hover)', text: 'var(--text-primary)' },
  ghost: { rest: 'transparent', hover: 'var(--surface-hover)', text: 'var(--text-body)' }
} as const

export function Button({
  variant = 'secondary',
  icon,
  disabled,
  onClick,
  children,
  className,
  style
}: ButtonProps): ReactElement {
  const [hover, setHover] = useState(false)
  const fill = FILL[variant]
  const hovered = hover && !disabled

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={className}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        height: 'var(--control-height)',
        padding: '0 12px',
        background: hovered ? fill.hover : fill.rest,
        color: fill.text,
        border: '1px solid transparent',
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base)',
        fontWeight: 'var(--weight-medium)',
        letterSpacing: 'var(--tracking-tight)',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        transition: 'var(--transition-control)',
        ...(disabled ? { opacity: 0.4, cursor: 'not-allowed' } : null),
        ...style
      }}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  )
}
