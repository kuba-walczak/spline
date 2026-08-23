import type { CSSProperties, ReactElement, ReactNode } from 'react'

export interface SectionLabelProps {
  children?: ReactNode
  action?: ReactNode
  flush?: boolean
  className?: string
  style?: CSSProperties
}

export function SectionLabel({ children, action, flush, className, style }: SectionLabelProps): ReactElement {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        padding: '0 0px',
        height: '20px',
        marginTop: flush ? 0 : 'var(--space-7)',
        marginBottom: 'var(--space-3)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-medium)',
        letterSpacing: 'var(--tracking-tight)',
        color: 'var(--text-faint)',
        ...style
      }}
    >
      <span>{children}</span>
      {action || null}
    </div>
  )
}
