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
  /** Projects currently attached to this chat (controlled by the parent). Attaching and detaching
      are both live: the context is rebuilt and the CLI process respawned either way. */
  attached?: ComposerProject[]
  onRemoveProject?: (id: string) => void
  /** Opens the project's injected context. */
  onOpenProject?: (id: string) => void
  onDictate?: () => void
  onVoice?: () => void
  className?: string
  style?: CSSProperties
}

/* The attachment box is the tallest thing in the control row, so the row is pinned to it: without
   that, detaching the last project drops the row to icon-button height and the whole composer
   changes size underneath the cursor. */
const ATTACHMENT_ROW_HEIGHT = 38

interface ProjectChipProps {
  project: ComposerProject
  onRemove: () => void
  onOpen: () => void
}

/** An attached project. Two targets in one chip: the name detaches the project, the chevron shows
    what it contributes to the system prompt. Nothing about an attachment is permanent — both
    directions rebuild the context and respawn the CLI.

    Hover is tracked on the chip rather than on either button so the chevron brightens whenever the
    chip is under the cursor, which is what advertises that there is something behind it. Declared at
    module scope because a component defined inside Composer would be a new type on every keystroke,
    remounting each chip as the draft changes. */
function ProjectChip({ project, onRemove, onOpen }: ProjectChipProps): ReactElement {
  const [hovered, setHovered] = useState(false)

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flex: '0 0 auto',
        maxWidth: 200,
        height: 28,
        background: 'var(--surface-control)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden'
      }}
    >
      <button
        type="button"
        onClick={onRemove}
        title={`Remove ${project.title}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          minWidth: 0,
          height: '100%',
          padding: '0 4px 0 10px',
          background: 'transparent',
          border: 'none',
          color: '#E6E5E2',
          font: 'var(--type-meta)',
          letterSpacing: 'var(--tracking-tight)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {project.title}
      </button>
      <button
        type="button"
        onClick={onOpen}
        title={`Show what ${project.title} injects`}
        aria-label={`Show what ${project.title} injects`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          flex: '0 0 auto',
          height: '100%',
          padding: '0 7px 0 3px',
          background: 'transparent',
          border: 'none',
          color: hovered ? '#E6E5E2' : 'var(--text-faint)',
          cursor: 'pointer',
          transition: 'var(--transition-control)'
        }}
      >
        <Icon name="chevron-down" size={12} />
      </button>
    </span>
  )
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
  onOpenProject,
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
          marginTop: 'var(--space-8)',
          minHeight: `${ATTACHMENT_ROW_HEIGHT}px`
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ position: 'relative', flex: '0 0 auto' }}>
          <IconButton
            icon="plus"
            label="Add"
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
        {/* Only drawn when something is attached — an empty bordered box reads as a broken control
            rather than as an affordance.

            Deliberately not `chatscroll`: that class reserves a stable scrollbar gutter on both
            edges, which inset the left and right by a further 10px each and left the box looking
            unevenly padded. Its scrollbar rules size a vertical bar anyway, and this scrolls
            horizontally. */}
        {attached.length > 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              minWidth: 0,
              height: `${ATTACHMENT_ROW_HEIGHT}px`,
              boxSizing: 'border-box',
              padding: '4px',
              background: '#111111',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              overflowX: 'auto'
            }}
          >
            {attached.map((p) => (
              <ProjectChip
                key={p.id}
                project={p}
                onRemove={() => onRemoveProject?.(p.id)}
                onOpen={() => onOpenProject?.(p.id)}
              />
            ))}
          </div>
        ) : null}
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
