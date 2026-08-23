import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { DropdownButton } from './dropdown-button'
import { IconButton } from './icon-button'
import { Icon } from './icon'

export interface ComposerProject {
  id: string
  title: string
}

export interface ComposerProps {
  value: string
  onChange?: (value: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  model?: string
  effort?: string
  onModelClick?: () => void
  onAdd?: () => void
  /** When provided, the plus button opens a dropdown of these instead of calling onAdd. */
  projects?: ComposerProject[]
  onSelectProject?: (id: string) => void
  /** Projects currently linked to this composer (controlled by the parent). */
  attached?: ComposerProject[]
  onRemoveProject?: (id: string) => void
  /** Once set, this chat is permanently bound to this project — attach UI is replaced with a locked badge. */
  lockedProject?: ComposerProject
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
  onAdd,
  projects,
  onSelectProject,
  attached = [],
  onRemoveProject,
  lockedProject,
  onDictate,
  onVoice,
  className,
  style
}: ComposerProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  function focusIfBackground(e: MouseEvent<HTMLDivElement>): void {
    if (e.target === e.currentTarget) textareaRef.current?.focus()
  }

  return (
    <div
      className={className}
      onClick={focusIfBackground}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxSizing: 'border-box',
        width: '100%',
        maxWidth: 'var(--composer-width)',
        minHeight: 'var(--composer-height)',
        padding: 'var(--space-9)',
        cursor: 'text',
        /* Same shell as ui/card: subtle surface, hairline border, xl radius. */
        background: '#20201F',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-xl)',
        ...style
      }}
    >
      <textarea
        ref={textareaRef}
        className="composer-input"
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
          margin: 0,
          maxHeight: '40vh',
          overflowY: 'auto'
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--space-6)',
          marginTop: 'var(--space-8)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          <IconButton
            icon="plus"
            label={lockedProject ? 'Project locked' : 'Add'}
            size="md"
            glyphSize={19}
            strokeWidth={2.5}
            active={menuOpen}
            disabled={Boolean(lockedProject)}
            onClick={() => (lockedProject ? undefined : projects ? setMenuOpen((v) => !v) : onAdd?.())}
            style={{ color: lockedProject ? 'var(--text-faint)' : '#E2E1DE' }}
          />
          {menuOpen && projects && !lockedProject ? (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 40 }}
              />
              <div
                className="chatscroll"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                  minWidth: 200,
                  maxHeight: 240,
                  overflowY: 'auto',
                  padding: 'var(--space-2)',
                  background: '#20201F',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                  zIndex: 41
                }}
              >
                {projects.filter((p) => !attached.some((a) => a.id === p.id)).length === 0 ? (
                  <div
                    style={{
                      padding: '6px 10px',
                      font: 'var(--type-meta)',
                      letterSpacing: 'var(--tracking-tight)',
                      color: 'var(--text-faint)'
                    }}
                  >
                    {projects.length === 0 ? 'No projects yet' : 'All projects attached'}
                  </div>
                ) : (
                  projects
                    .filter((p) => !attached.some((a) => a.id === p.id))
                    .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false)
                        onSelectProject?.(p.id)
                      }}
                      style={{
                        display: 'block',
                        width: '100%',
                        boxSizing: 'border-box',
                        textAlign: 'left',
                        padding: '4px 8px',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 'var(--radius-sm)',
                        color: '#E6E5E2',
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--text-base)',
                        fontWeight: 'var(--weight-regular)',
                        lineHeight: 'var(--leading-normal)',
                        letterSpacing: 'var(--tracking-tight)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {p.title}
                    </button>
                  ))
                )}
              </div>
            </>
          ) : null}
        </div>
        {lockedProject ? (
          <span
            title={`Locked to ${lockedProject.title}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              flex: '0 0 auto',
              maxWidth: 180,
              height: 28,
              padding: '0 10px',
              background: 'var(--surface-control)',
              opacity: 0.6,
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-faint)',
              font: 'var(--type-meta)',
              letterSpacing: 'var(--tracking-tight)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            <Icon name="lock" size={12} />
            {lockedProject.title}
          </span>
        ) : (
        attached.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onRemoveProject?.(p.id)}
            title={`Remove ${p.title}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              flex: '0 0 auto',
              maxWidth: 160,
              height: 28,
              padding: '0 10px',
              background: 'var(--surface-control)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              color: '#E6E5E2',
              font: 'var(--type-meta)',
              letterSpacing: 'var(--tracking-tight)',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              transition: 'var(--transition-control)'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-control-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface-control)')}
          >
            {p.title}
          </button>
        ))
        )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
          {model ? <DropdownButton variant="bare" value={model} detail={effort} onClick={onModelClick} /> : null}
          <IconButton
            icon="mic"
            label="Dictate"
            size="md"
            glyphSize={19}
            onClick={onDictate}
            style={{ color: '#E2E1DE' }}
          />
          <IconButton
            icon="audio-lines"
            label="Voice mode"
            size="md"
            glyphSize={19}
            onClick={onVoice}
            style={{ color: '#E2E1DE' }}
          />
        </div>
      </div>
    </div>
  )
}
