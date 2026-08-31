import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent, ReactElement } from 'react'
import { DropdownButton } from './dropdown-button'
import { IconButton } from './icon-button'
import { Icon } from './icon'
import { CONTEXT_WINDOW, formatTokens, usageFraction } from '@shared/tokenUsage'

export interface ComposerProject {
  id: string
  title: string
}

export interface ComposerSkill {
  id: string
  name: string
  /** A persistent skill toggles on and stays; a one-shot one arms the next message. */
  mode: 'persistent' | 'oneshot'
}

export interface ComposerModel {
  id: string
  name: string
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
  defaultModelId?: string
  defaultEffortId?: string
  onSelectEffort?: (id: string) => void
  projects?: ComposerProject[]
  onSelectProject?: (id: string) => void
  /** Projects currently attached to this chat (controlled by the parent). Attaching and detaching
      are both live: the context is rebuilt and the CLI process respawned either way. */
  attached?: ComposerProject[]
  onRemoveProject?: (id: string) => void
  /** Opens the project's injected context. */
  onOpenProject?: (id: string) => void
  /** Every skill. Persistent ones show a tick when switched on for this chat. */
  skills?: ComposerSkill[]
  activeSkillNames?: string[]
  onToggleSkill?: (name: string) => void
  /** Armed for the next message by picking a one-shot skill. */
  pendingSkillName?: string | null
  onInvokeSkill?: (id: string) => void
  onClearPendingSkill?: () => void
  /** Opens the armed skill's instructions — the chevron on its chip, matching a project's. */
  onOpenPendingSkill?: () => void
  /** Context the chat's last turn was holding, in tokens. `null` until it has had one — a chat that
      has not spoken yet has nothing to measure, and the meter stays hidden. */
  contextTokens?: number | null
  onDictate?: () => void
  onVoice?: () => void
  className?: string
  style?: CSSProperties
}

/* The attachment box is the tallest thing in the control row, so the row is pinned to it: without
   that, detaching the last project drops the row to icon-button height and the whole composer
   changes size underneath the cursor. */
const ATTACHMENT_ROW_HEIGHT = 38

/** What a click must not have landed inside for it to count as a click on the composer's
    background. Buttons carry their own behaviour; everything else in here is layout. */
const INTERACTIVE_SELECTOR = 'button, a, input, textarea, select, [role="button"], [contenteditable]'

/** How full the window gets before the bar stops being neutral. Two steps: the first says the chat
    is getting long, the second that the next few turns will start dropping the top of it. */
const CONTEXT_WARN = 0.7
const CONTEXT_FULL = 0.9

/** The chat's context window, as the header of the model menu. It belongs with the model: the
    window is a property of the one selected, and the menu is where that is chosen.

    Behind a menu rather than always in view because it is a number worth checking, not watching —
    and in here there is room to print it, which the strip across the composer never had. */
/** Marks the model or effort a new chat starts on, in both lists. */
function DefaultBadge(): ReactElement {
  return (
    <span
      style={{
        flex: '0 0 auto',
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
  )
}

function ContextMeter({ tokens }: { tokens: number }): ReactElement {
  const fraction = usageFraction(tokens)
  const color =
    fraction >= CONTEXT_FULL ? '#D9603F' : fraction >= CONTEXT_WARN ? '#C99A3F' : 'var(--text-faint)'

  return (
    <>
      <div style={{ padding: '6px 10px 10px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 7,
            font: 'var(--weight-regular) var(--text-sm)/1 var(--font-sans)',
            letterSpacing: 'var(--tracking-tight)'
          }}
        >
          <span style={{ color: 'var(--text-muted)' }}>Context</span>
          <span style={{ color: 'var(--text-faint)' }}>
            {formatTokens(tokens)} / {formatTokens(CONTEXT_WINDOW)}
          </span>
        </div>
        <div
          style={{
            height: 3,
            background: 'var(--surface-control)',
            borderRadius: 999,
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              width: `${fraction * 100}%`,
              height: '100%',
              background: color,
              borderRadius: 999,
              /* The width jumps once per turn, so animating it reads as the bar filling rather than
                 as a repaint. */
              transition: 'width 240ms ease, background 240ms ease'
            }}
          />
        </div>
      </div>
      <div style={{ height: 1, margin: 'var(--space-2) calc(var(--space-2) * -1)', background: 'var(--border-default)' }} />
    </>
  )
}

interface AttachmentChipProps {
  label: string
  removeTitle: string
  openTitle: string
  onRemove: () => void
  onOpen: () => void
}

/** Something attached to the next message — a project, or a one-shot skill. Two targets in one
    chip: the name detaches it, the chevron shows the text it contributes. Nothing about an
    attachment is permanent; detaching a project rebuilds the context and respawns the CLI, and
    dropping a skill simply disarms it.

    Hover is tracked on the chip rather than on either button so the chevron brightens whenever the
    chip is under the cursor, which is what advertises that there is something behind it. Declared at
    module scope because a component defined inside Composer would be a new type on every keystroke,
    remounting each chip as the draft changes. */
function AttachmentChip({ label, removeTitle, openTitle, onRemove, onOpen }: AttachmentChipProps): ReactElement {
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
        title={removeTitle}
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
        {label}
      </button>
      <button
        type="button"
        onClick={onOpen}
        title={openTitle}
        aria-label={openTitle}
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

/** One row of the composer's add menu, matching the sidebar's row options menu. */
function ComposerMenuItem({
  label,
  trailing,
  active,
  checked,
  onHover,
  onClick
}: {
  label: string
  trailing?: string
  active?: boolean
  checked?: boolean
  onHover?: () => void
  onClick: () => void
}): ReactElement {
  const background = active ? 'var(--surface-hover)' : 'transparent'

  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      onFocus={onHover}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-hover)'
        onHover?.()
      }}
      onMouseLeave={(e) => (e.currentTarget.style.background = background)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        boxSizing: 'border-box',
        textAlign: 'left',
        padding: '4px 8px',
        background,
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        color: '#E6E5E2',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-base)',
        fontWeight: 'var(--weight-regular)',
        lineHeight: 'var(--leading-normal)',
        letterSpacing: 'var(--tracking-tight)',
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {/* Chevron or tick, both on the right — a reserved slot on the left would indent every label
          past the ones in a list that has nothing to tick. */}
      {trailing ? (
        <span style={{ display: 'inline-flex', flex: '0 0 auto', color: 'var(--text-faint)' }}>
          <Icon name={trailing} size={14} />
        </span>
      ) : checked ? (
        <span style={{ display: 'inline-flex', flex: '0 0 auto', color: '#C96442' }}>
          <Icon name="check" size={14} />
        </span>
      ) : null}
    </button>
  )
}

function ComposerMenuEmpty({ label }: { label: string }): ReactElement {
  return (
    <div
      style={{
        padding: '4px 8px',
        font: 'var(--type-meta)',
        letterSpacing: 'var(--tracking-tight)',
        color: 'var(--text-faint)',
        whiteSpace: 'nowrap'
      }}
    >
      {label}
    </div>
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
  defaultModelId,
  defaultEffortId,
  onSelectEffort,
  projects,
  onSelectProject,
  attached = [],
  onRemoveProject,
  onOpenProject,
  skills = [],
  activeSkillNames = [],
  onToggleSkill,
  pendingSkillName,
  onInvokeSkill,
  onClearPendingSkill,
  onOpenPendingSkill,
  contextTokens = null,
  onDictate,
  onVoice,
  className,
  style
}: ComposerProps): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  /* Which of the two lists is showing beside the menu. */
  const [kind, setKind] = useState<'projects' | 'skills' | null>(null)
  /** Lifts the composer's border while the pointer is inside it — the box is the target for a
      click anywhere in it, and nothing else said so. */
  const [hovered, setHovered] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [effortMenuOpen, setEffortMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const attachableProjects = (projects ?? []).filter((p) => !attached.some((a) => a.id === p.id))
  /* An armed one-shot skill drops out of the list, the way an attached project does — it is already
     shown as a chip, and picking it twice would do nothing. A persistent skill stays put even when
     switched on: its row is the only way to switch it back off. */
  const availableSkills = skills.filter((sk) => sk.name !== pendingSkillName)
  const selectedModel = models?.find((m) => m.id === modelId)
  const selectedEffort = efforts?.find((e) => e.id === effortId)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  /* Clicking the composer's empty space puts the cursor in the draft. Testing `target === root`
     only ever covered the padding above the textarea: everything across the bottom — the gaps in
     the control row, the space between the plus button and the model name, the attachment box's
     own padding — is a layout div, so a click there hit a child and did nothing. The whole strip
     read as dead, as if something were covering it.

     Interactive descendants are excluded by ancestry rather than by identity, since a click can
     land on the glyph inside a button rather than on the button itself. */
  function focusIfBackground(e: MouseEvent<HTMLDivElement>): void {
    const target = e.target as Element
    if (typeof target.closest === 'function' && target.closest(INTERACTIVE_SELECTOR)) return
    textareaRef.current?.focus()
  }

  return (
    <div
      className={className}
      onClick={focusIfBackground}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
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
        border: `1px solid ${hovered ? '#4D4D4C' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-xl)',
        transition: 'var(--transition-control)',
        ...style
      }}
    >
      <textarea
        ref={textareaRef}
        className="composer-input chatscroll"
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
            onClick={() => {
              setMenuOpen((v) => !v)
              setKind(null)
            }}
            style={{ color: '#E2E1DE' }}
          />
          {menuOpen ? (
            <>
              <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 8px)',
                  left: 0,
                  zIndex: 41,
                  minWidth: 140,
                  padding: 'var(--space-2)',
                  background: '#20201F',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
                }}
              >
                <ComposerMenuItem
                  label="Projects"
                  trailing="chevron-right"
                  active={kind === 'projects'}
                  onHover={() => setKind('projects')}
                  onClick={() => setKind('projects')}
                />
                <ComposerMenuItem
                  label="Skills"
                  trailing="chevron-right"
                  active={kind === 'skills'}
                  onHover={() => setKind('skills')}
                  onClick={() => setKind('skills')}
                />

                {kind ? (
                  /* The separation is this wrapper's padding rather than an offset, so crossing it
                     keeps the pointer inside the menu and the flyout does not flicker shut. */
                  <div style={{ position: 'absolute', left: '100%', bottom: 0, paddingLeft: 12 }}>
                    <div
                      style={{
                        minWidth: 200,
                        maxHeight: 260,
                        overflowY: 'auto',
                        padding: 'var(--space-2)',
                        background: '#20201F',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
                      }}
                    >
                      {kind === 'projects' ? (
                        attachableProjects.length === 0 ? (
                          <ComposerMenuEmpty
                            label={projects && projects.length > 0 ? 'All projects attached' : 'No projects yet'}
                          />
                        ) : (
                          attachableProjects.map((p) => (
                            <ComposerMenuItem
                              key={p.id}
                              label={p.title}
                              onClick={() => {
                                setMenuOpen(false)
                                onSelectProject?.(p.id)
                              }}
                            />
                          ))
                        )
                      ) : availableSkills.length === 0 ? (
                        <ComposerMenuEmpty label={skills.length > 0 ? 'No other skills' : 'No skills yet'} />
                      ) : (
                        availableSkills.map((skill) => (
                          <ComposerMenuItem
                            key={skill.id}
                            label={skill.name}
                            /* A persistent skill is switched on and stays; a one-shot one is armed
                               for the next message, so picking it closes the menu. */
                            checked={skill.mode === 'persistent' && activeSkillNames.includes(skill.name)}
                            onClick={() => {
                              if (skill.mode === 'persistent') {
                                onToggleSkill?.(skill.name)
                                return
                              }
                              setMenuOpen(false)
                              onInvokeSkill?.(skill.id)
                            }}
                          />
                        ))
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>

        {/* Only drawn when something is attached — an empty bordered box reads as a broken control
            rather than as an affordance.

            Deliberately not `chatscroll`: that class reserves a stable scrollbar gutter on both
            edges, which inset the left and right by a further 10px each and left the box looking
            unevenly padded. Its scrollbar rules size a vertical bar anyway, and this scrolls
            horizontally. `chipscroll` instead hides the horizontal bar outright — at 38px tall
            there is no room for one that does not cover the chips it scrolls. */}
        {attached.length > 0 ? (
          <div
            className="chipscroll"
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
              <AttachmentChip
                key={p.id}
                label={p.title}
                removeTitle={`Remove ${p.title}`}
                openTitle={`Show what ${p.title} injects`}
                onRemove={() => onRemoveProject?.(p.id)}
                onOpen={() => onOpenProject?.(p.id)}
              />
            ))}
          </div>
        ) : null}

        {/* The one-shot skill waiting on the next message. Sits after the projects box rather than
            before it: a project is attached for the whole chat, the skill only for the message
            about to be sent, so reading left to right goes from the standing context to the thing
            armed right now. Cleared by sending the message or by dismissing the chip. */}
        {pendingSkillName ? (
          <AttachmentChip
            label={pendingSkillName}
            removeTitle={`Remove ${pendingSkillName}`}
            openTitle={`Show what ${pendingSkillName} injects`}
            onRemove={() => onClearPendingSkill?.()}
            onOpen={() => onOpenPendingSkill?.()}
          />
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
                  {contextTokens !== null && contextTokens > 0 ? <ContextMeter tokens={contextTokens} /> : null}
                  {/* Sideways is explicitly off. A scroll container with `overflow-y: auto` computes
                      its `overflow-x` to `auto` as well, so any sub-pixel overflow — a letter-spaced
                      last character, a rounded 100%-width row — puts a horizontal bar under the
                      list. Nothing in a menu should scroll sideways anyway. */}
                  <div style={{ maxHeight: 320, overflowY: 'auto', overflowX: 'hidden' }}>
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
                          alignItems: 'center',
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
                        onMouseEnter={(ev) => {
                          ev.currentTarget.style.background = 'var(--surface-hover)'
                          /* A model row has no list of its own, so hovering one closes the effort
                             flyout — it follows the pointer rather than lingering. */
                          setEffortMenuOpen(false)
                        }}
                        onMouseLeave={(ev) => (ev.currentTarget.style.background = 'transparent')}
                      >
                        <span
                          style={{
                            flex: '1 1 auto',
                            minWidth: 0,
                            font: 'var(--weight-medium) var(--text-base)/1.2 var(--font-sans)',
                            letterSpacing: 'var(--tracking-tight)',
                            color: 'var(--text-primary)',
                            /* A name long enough to crowd the badge is cut rather than pushing the
                               row wider than the list. */
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {m.name}
                        </span>
                        {m.id === defaultModelId ? <DefaultBadge /> : null}
                        {m.id === modelId ? (
                          <span style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', height: 17, color: '#4a9eff' }}>
                            <Icon name="check" size={17} />
                          </span>
                        ) : null}
                      </button>
                    ))}

                    {efforts ? (
                      <>
                        <div style={{ height: 1, margin: 'var(--space-2) calc(var(--space-2) * -1)', background: 'var(--border-default)' }} />
                        <button
                          type="button"
                          onClick={() => setEffortMenuOpen(true)}
                          onFocus={() => setEffortMenuOpen(true)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            width: '100%',
                            boxSizing: 'border-box',
                            /* Same content-sized box as the model rows above it and the rows in its
                               own flyout — it sits among them, so it measures like one. */
                            padding: 'var(--space-3)',
                            background: effortMenuOpen ? 'var(--surface-hover)' : 'transparent',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            cursor: 'pointer',
                            textAlign: 'left'
                          }}
                          onMouseEnter={(ev) => {
                            ev.currentTarget.style.background = 'var(--surface-hover)'
                            setEffortMenuOpen(true)
                          }}
                          onMouseLeave={(ev) => (ev.currentTarget.style.background = effortMenuOpen ? 'var(--surface-hover)' : 'transparent')}
                        >
                          <span
                            style={{
                              flex: '1 1 auto',
                              font: 'var(--weight-medium) var(--text-base)/1.2 var(--font-sans)',
                              letterSpacing: 'var(--tracking-tight)',
                              color: 'var(--text-primary)'
                            }}
                          >
                            Effort
                          </span>
                          <span
                            style={{
                              font: 'var(--weight-regular) var(--text-base)/1.2 var(--font-sans)',
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
                    /* The separation is this wrapper's padding rather than an offset, so crossing it
                       keeps the pointer inside the menu and the flyout does not flicker shut. */
                    <div style={{ position: 'absolute', left: '100%', bottom: 0, paddingLeft: 12, zIndex: 41 }}>
                    <div
                      style={{
                        width: 300,
                        padding: 'var(--space-2)',
                        boxSizing: 'border-box',
                        background: '#20201F',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
                      }}
                    >
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
                          /* Sized by its content on the same padding the model rows use, rather than
                             by a fixed height, so the two lists match. */
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
                        <span
                          style={{
                            font: 'var(--weight-medium) var(--text-base)/1.2 var(--font-sans)',
                            letterSpacing: 'var(--tracking-tight)',
                            color: 'var(--text-primary)'
                          }}
                        >
                          {e.name}
                        </span>
                        {e.id === defaultEffortId ? <DefaultBadge /> : null}
                        <span style={{ flex: '1 1 auto' }} />
                        {e.id === effortId ? (
                          <span style={{ display: 'flex', alignItems: 'center', color: '#4a9eff' }}>
                            <Icon name="check" size={15} />
                          </span>
                        ) : null}
                      </button>
                    ))}
                      </div>
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
