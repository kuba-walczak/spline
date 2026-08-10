import type { CSSProperties, KeyboardEvent, ReactElement } from 'react'
import { DropdownButton } from './dropdown-button'
import { IconButton } from './icon-button'

export interface ComposerProps {
  value: string
  onChange?: (value: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  model?: string
  effort?: string
  onModelClick?: () => void
  onDictate?: () => void
  onVoice?: () => void
  className?: string
  style?: CSSProperties
}

export function Composer({
  value,
  onChange,
  onKeyDown,
  placeholder = 'How can I help you today?',
  model,
  effort,
  onModelClick,
  onDictate,
  onVoice,
  className,
  style
}: ComposerProps): ReactElement {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: 'var(--composer-width)',
        minHeight: 'var(--composer-height)',
        padding: 'var(--space-9)',
        background: 'var(--surface-raised)',
        border: '1px solid transparent',
        borderRadius: 'var(--radius-xl)',
        ...style
      }}
    >
      <textarea
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        rows={1}
        style={{
          width: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--text-primary)',
          font: 'var(--weight-regular) var(--text-md)/1.4 var(--font-sans)',
          letterSpacing: 'var(--tracking-tight)',
          padding: 0,
          margin: 0
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 'var(--space-6)',
          marginTop: 'var(--space-8)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
          {model ? <DropdownButton variant="bare" value={model} detail={effort} onClick={onModelClick} /> : null}
          <IconButton icon="mic" label="Dictate" size="sm" glyphSize={17} onClick={onDictate} />
          <IconButton icon="audio-lines" label="Voice mode" size="sm" glyphSize={17} onClick={onVoice} />
        </div>
      </div>
    </div>
  )
}
