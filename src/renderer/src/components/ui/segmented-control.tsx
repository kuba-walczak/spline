import type { CSSProperties, ReactElement } from 'react'
import { Icon } from './icon'
import type { IconName } from './icon'

export interface SegmentedItem {
  value: string
  label: string
  icon?: IconName
}

export interface SegmentedControlProps {
  items: SegmentedItem[]
  value: string
  onChange?: (value: string) => void
  variant?: 'default' | 'inset'
  fill?: boolean
  /** Drops the labels, leaving each item as its icon. For narrow containers, where the labels would
      otherwise be clipped mid-word. Items without an icon keep their label regardless — a blank
      button would be unusable. */
  iconsOnly?: boolean
  className?: string
  style?: CSSProperties
}

export function SegmentedControl({
  items,
  value,
  onChange,
  variant = 'default',
  fill,
  iconsOnly,
  className,
  style
}: SegmentedControlProps): ReactElement {
  const inset = variant === 'inset'
  return (
    <div
      role="tablist"
      className={className}
      style={{
        display: 'inline-grid',
        gridAutoFlow: 'column',
        gridAutoColumns: fill ? '1fr' : 'auto',
        width: fill ? '100%' : 'auto',
        boxSizing: 'border-box',
        background: inset ? 'var(--surface-inset)' : '#1F1F1F',
        borderRadius: 'var(--radius-md)',
        height: inset ? '24px' : 'var(--control-height-sm)',
        ...style
      }}
    >
      {items.map((it) => {
        const on = it.value === value
        const collapsed = Boolean(iconsOnly && it.icon)
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange && onChange(it.value)}
            title={collapsed ? it.label : undefined}
            aria-label={collapsed ? it.label : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              height: '100%',
              padding: collapsed ? '0' : inset ? '0 12px' : '0 14px',
              minWidth: 0,
              boxSizing: 'border-box',
              background: on ? (inset ? 'var(--surface-thumb-inset)' : '#363636') : '#1F1F1F',
              border: on
                ? `1px solid ${inset ? 'var(--border-inset)' : 'var(--border-default)'}`
                : '1px solid transparent',
              borderRadius: inset ? 'var(--radius-sm)' : 'var(--radius-md)',
              color: on ? 'var(--text-primary)' : 'var(--text-muted)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--text-base)',
              fontWeight: on ? 'var(--weight-semibold)' : 'var(--weight-medium)',
              letterSpacing: 'var(--tracking-tight)',
              lineHeight: 1,
              cursor: 'pointer',
              transition: 'var(--transition-control)'
            }}
            onMouseEnter={(e) => {
              if (!on) e.currentTarget.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={(e) => {
              if (!on) e.currentTarget.style.color = 'var(--text-muted)'
            }}
          >
            {it.icon ? <Icon name={it.icon} size={14} /> : null}
            {collapsed ? null : it.label}
          </button>
        )
      })}
    </div>
  )
}
