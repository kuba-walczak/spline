import type { ReactElement } from 'react'

/** Track-and-knob toggle. Rendered as a real checkbox so it is keyboard-reachable and announced as
    a switch, with the input itself hidden behind the drawn control. */
export function Switch({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}): ReactElement {
  return (
    <label
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        flex: '0 0 auto',
        width: '38px',
        height: '22px',
        cursor: 'pointer'
      }}
    >
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, margin: 0 }}
      />
      <span
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          borderRadius: 'var(--radius-full)',
          background: checked ? '#C96442' : 'var(--surface-control)',
          transition: 'var(--transition-control)'
        }}
      />
      <span
        style={{
          position: 'absolute',
          top: '3px',
          left: checked ? '19px' : '3px',
          width: '16px',
          height: '16px',
          borderRadius: 'var(--radius-full)',
          background: '#E6E5E2',
          transition: 'var(--transition-control)'
        }}
      />
    </label>
  )
}
