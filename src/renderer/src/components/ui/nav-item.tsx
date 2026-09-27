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
  /** Overrides the hover and selected background. Chat rows sit on their own surface, distinct
      from the nav items above them. */
  highlight?: string
  /** Forces the hover appearance from outside. Controls that sit over the row — the chats' options
      button — are siblings rather than children, so pointing at one takes the cursor off this
      button and the row would otherwise go flat while its own menu is being used. */
  hovered?: boolean
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
  highlight,
  hovered = false,
  onClick,
  className,
  style
}: NavItemProps): ReactElement {
  const [hover, setHover] = useState(false)
  const background = active
    ? highlight ?? 'var(--surface-selected)'
    : hover || hovered
      ? highlight ?? 'var(--surface-hover)'
      : 'transparent'

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
      {/* The row's own `line-height: 1` is what centres the icon and badge against a fixed row
          height, but a 1em line box on a 1em font has no room under the baseline — and this span
          has to clip, because clipping is what draws the ellipsis. So the descenders of a `y` or a
          `g` were cut off flat. The label gets a line box taller than its glyphs instead; the row
          is a fixed height and centres it, so nothing moves. */}
      <span
        style={{
          flex: '1 1 auto',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 'var(--leading-normal)'
        }}
      >
        {label}
      </span>
      {badge ? <Badge variant="bare">{badge}</Badge> : null}
      {trailing || null}
    </button>
  )
}
