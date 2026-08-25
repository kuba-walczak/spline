import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { DropdownButton } from './dropdown-button'
import { IconButton } from './icon-button'
import { Icon } from './icon'

export interface ComposerProject {
  id: string
  title: string
}

export interface ComposerModel {
  id: string
  name: string
  description: string
}

export interface ComposerEffort {
  id: string
  name: string
}

export interface ComposerProps {
  value: string
  onChange?: (value: string) => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  model?: string
  effort?: string
  onModelClick?: () => void
  /** When provided (with modelId), the model/effort button opens the model menu instead of calling onModelClick. */
  models?: ComposerModel[]
  modelId?: string
  onSelectModel?: (id: string) => void
  efforts?: ComposerEffort[]
  effortId?: string
  defaultEffortId?: string
  onSelectEffort?: (id: string) => void
  onAdd?: () => void
  /** When provided, the plus button opens a dropdown of these instead of calling onAdd. */
  projects?: ComposerProject[]
  onSelectProject?: (id: string) => void
  /** Projects currently linked to this composer (controlled by the parent). */
  attached?: ComposerProject[]
  onRemoveProject?: (id: string) => void
  /** Projects already permanently bound to this chat — shown as locked badges, not offered again in the dropdown. */
  lockedProjects?: ComposerProject[]
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
  models,
  modelId,
  onSelectModel,
  efforts,
  effortId,
  defaultEffortId,
  onSelectEffort,
  onAdd,
  projects,
  onSelectProject,
  attached = [],
  onRemoveProject,
  lockedProjects = [],
  onDictate,
  onVoice,
  className,
  style
}: ComposerProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const selectedModel = models?.find((m) => m.id === modelId)
  const selectedEffort = efforts?.find((e) => e.id === effortId)

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
            label={lockedProjects.length > 0 ? 'Project locked' : 'Add'}
            size="md"
            glyphSize={19}
            strokeWidth={2.5}
            active={menuOpen}
            onClick={() => (projects ? setMenuOpen((v) => !v) : onAdd?.())}
            style={{ color: '#E2E1DE' }}
          />
          {menuOpen && projects ? (
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
                {projects.filter((p) => !attached.some((a) => a.id === p.id) && !lockedProjects.some((l) => l.id === p.id)).length === 0 ? (
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
                    .filter((p) => !attached.some((a) => a.id === p.id) && !lockedProjects.some((l) => l.id === p.id))
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
        {lockedProjects.map((p) => (
          <span
            key={p.id}
            title={`Locked to ${p.title}`}
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
            {p.title}
          </span>
        ))}
        {attached.map((p) => (
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
        ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
          {models && modelId ? (
            <div style={{ position: 'relative', flex: '0 0 auto' }}>
              <DropdownButton
                variant="bare"
                value={selectedModel?.name ?? model ?? ''}
                detail={selectedEffort?.name}
                onClick={() => {
                  setModelMenuOpen((v) => !v)
                  setEffortMenuOpen(false)
                }}
              />
              {modelMenuOpen ? (
                <>
                  <div
                    onClick={() => {
                      setModelMenuOpen(false)
                      setEffortMenuOpen(false)
                    }}
                    style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 'calc(100% + 8px)',
                      right: 0,
                      width: 260,
                      padding: 'var(--space-2)',
                      boxSizing: 'border-box',
                      background: '#20201F',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                      zIndex: 41
                    }}
                  >
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onSelectModel?.(m.id)
                          setModelMenuOpen(false)
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: 'var(--space-3)',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: 'var(--radius-sm)',
                          cursor: 'pointer',
                          textAlign: 'left'
                        }}
                        onMouseEnter={(ev) => (ev.currentTarget.style.background = 'var(--surface-hover)')}
                        onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                      >
                        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <span
                            style={{
                              font: 'var(--weight-medium) var(--text-base)/1.2 var(--font-sans)',
                              letterSpacing: 'var(--tracking-tight)',
                              color: 'var(--text-primary)'
                            }}
                          >
                            {m.name}
                          </span>
                          <span
                            style={{
                              font: 'var(--weight-regular) var(--text-sm)/1.35 var(--font-sans)',
                              letterSpacing: 'var(--tracking-tight)',
                              color: 'var(--text-muted)'
                            }}
                          >
                            {m.description}
                          </span>
                        </div>
                        {m.id === modelId ? (
                          <span style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', height: 17, color: '#4a9eff' }}>
                            <Icon name="check" size={17} />
                          </span>
                        ) : null}
                      </button>
                    ))}

                    {efforts ? (
                      <>
                        <div style={{ height: 1, margin: 'var(--space-2) 8px', background: 'var(--border-default)' }} />
                        <button
                          type="button"
                          onClick={() => setEffortMenuOpen((v) => !v)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            width: '100%',
                            boxSizing: 'border-box',
                            height: 40,
                            padding: '0 10px 0 8px',
                            background: effortMenuOpen ? 'var(--surface-hover)' : 'transparent',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            textAlign: 'left'
                          }}
                          onMouseEnter={(ev) => (ev.currentTarget.style.background = 'var(--surface-hover)')}
                          onMouseLeave={(ev) => (ev.currentTarget.style.background = effortMenuOpen ? 'var(--surface-hover)' : 'transparent')}
                        >
                          <span
                            style={{
                              flex: '1 1 auto',
                              font: 'var(--weight-medium) var(--text-base)/1 var(--font-sans)',
                              letterSpacing: 'var(--tracking-tight)',
                              color: 'var(--text-primary)'
                            }}
                          >
                            Effort
                          </span>
                          <span
                            style={{
                              font: 'var(--weight-regular) var(--text-base)/1 var(--font-sans)',
                              letterSpacing: 'var(--tracking-tight)',
                              color: 'var(--text-muted)'
                            }}
                          >
                            {selectedEffort?.name}
                          </span>
                          <span style={{ display: 'flex', alignItems: 'center', color: 'var(--text-faint)' }}>
                            <Icon name="chevron-right" size={15} />
                          </span>
                        </button>
                      </>
                    ) : null}
                  </div>

                  {effortMenuOpen && efforts ? (
                    <div
                      style={{
                        position: 'absolute',
                        left: 'calc(100% + 12px)',
                        bottom: 0,
                        width: 300,
                        padding: 'var(--space-2)',
                        boxSizing: 'border-box',
                        background: '#20201F',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                        zIndex: 41
                      }}
                    >
                      <p
                              style={{
                                margin: 0,
                                padding: '10px 10px 12px',
                                font: 'var(--weight-regular) var(--text-sm)/1.45 var(--font-sans)',
                                letterSpacing: 'var(--tracking-tight)',
                                color: 'var(--text-muted)'
                              }}
                            >
                              Higher effort means more thorough responses, but takes longer and uses your limits faster.
                            </p>
                            {efforts.map((e) => (
                              <button
                                key={e.id}
                                type="button"
                                onClick={() => {
                                  onSelectEffort?.(e.id)
                                  setEffortMenuOpen(false)
                                  setModelMenuOpen(false)
                                }}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  width: '100%',
                                  boxSizing: 'border-box',
                                  height: 36,
                                  padding: 'var(--space-2) 8px',
                                  background: 'transparent',
                                  border: 'none',
                                  borderRadius: 'var(--radius-sm)',
                                  cursor: 'pointer',
                                  textAlign: 'left'
                                }}
                                onMouseEnter={(ev) => (ev.currentTarget.style.background = 'var(--surface-hover)')}
                                onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                              >
                                <span
                                  style={{
                                    font: 'var(--weight-medium) var(--text-base)/1 var(--font-sans)',
                                    letterSpacing: 'var(--tracking-tight)',
                                    color: 'var(--text-primary)'
                                  }}
                                >
                                  {e.name}
                                </span>
                                {e.id === defaultEffortId ? (
                                  <span
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      height: 18,
                                      padding: '0 6px',
                                      background: 'var(--surface-control)',
                                      borderRadius: 4,
                                      font: 'var(--weight-medium) var(--text-xs)/1 var(--font-sans)',
                                      color: 'var(--text-body)'
                                    }}
                                  >
                                    Default
                                  </span>
                                ) : null}
                                <span style={{ flex: '1 1 auto' }} />
                                {e.id === effortId ? (
                                  <span style={{ display: 'flex', alignItems: 'center', color: '#4a9eff' }}>
                                    <Icon name="check" size={15} />
                                  </span>
                                ) : null}
                              </button>
                            ))}
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : model ? (
            <DropdownButton variant="bare" value={model} detail={effort} onClick={onModelClick} />
          ) : null}
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
