import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Skeleton } from '@/components/ui/skeleton'
import { EMPTY_SKILL_DATA, type Skill, type SkillMode } from '@shared/skills'

/* Editing one skill: what it is, when it applies, and what it says.

   Everything round-trips through Notion the way Instructions do elsewhere — draft state, a dirty
   check against what was loaded, an explicit sync. Nothing here is sent to the model on its own;
   the body reaches a conversation only when the skill is switched on or typed. */

const headingStyle: CSSProperties = {
  margin: 0,
  font: 'var(--type-body-strong)',
  color: 'var(--text-primary)',
  letterSpacing: 'var(--tracking-tight)'
}

const fieldStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  background: 'var(--surface-inset)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-body)',
  font: 'var(--weight-regular) var(--text-base)/1.5 var(--font-sans)',
  outline: 'none',
  /* The global `*:focus-visible` ring reads as a highlight around a field that already has its own
     border, so it is suppressed here the way the composer's input suppresses it. */
  boxShadow: 'none'
}

/* Panel shell: matches the project view's aside — inset padding, hairline divider on every section
   but the last. */
function panelStyle(last = false): CSSProperties {
  return { padding: 'var(--space-7)', borderBottom: last ? 'none' : '1px solid var(--border-default)' }
}

/** Shared by the name field and the mode control, so the two sit level rather than one being
    sized by its padding and the other by a control token. */
const FIELD_HEIGHT = 42

const noteStyle: CSSProperties = {
  margin: '0 0 12px',
  font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
  letterSpacing: 'var(--tracking-tight)',
  color: 'var(--text-muted)'
}

export interface SkillDetailViewProps {
  skillId: string
  /** The list's copy, shown as the heading until the fresh read lands so the page is never nameless. */
  fallbackName: string
  onBack: () => void
  onSaved: () => void
}

export function SkillDetailView({
  skillId,
  fallbackName,
  onBack,
  onSaved
}: SkillDetailViewProps): ReactElement {
  /* Re-read on selection rather than rendering the startup list's copy, the same way a project
     fetches its detail when opened — otherwise an edit made in Notion would not show until the app
     restarted. The list still carries bodies, because invoking a one-shot skill has to be instant. */
  const [skill, setSkill] = useState<Skill | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const [name, setName] = useState('')
  const [mode, setMode] = useState<SkillMode>(EMPTY_SKILL_DATA.mode)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)

    window.api
      .getSkill(skillId)
      .then((loaded) => {
        if (cancelled) return
        setSkill(loaded)
        setName(loaded.name)
        setMode(loaded.mode)
        setBody(loaded.body)
      })
      .catch((error) => {
        console.error('[skills] getSkill failed:', error)
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [skillId])

  const title = skill?.name || fallbackName || 'Untitled'
  const ready = skill !== null && !loading && !failed
  const dirty =
    ready &&
    (name !== skill.name || mode !== skill.mode || body !== skill.body)

  async function save(): Promise<void> {
    if (saving || !dirty || !skill) return
    setSaving(true)
    try {
      if (name !== skill.name) await window.api.renameSkill(skillId, name)
      await window.api.saveSkill(skillId, { mode, body })
      setSkill({ id: skillId, name, mode, body })
      onSaved()
    } catch (error) {
      console.error('[skills] save failed:', error)
    } finally {
      setSaving(false)
    }
  }

  /** Throws the unsynced edits away, back to what Notion last gave us. */
  function discard(): void {
    if (!skill) return
    setName(skill.name)
    setMode(skill.mode)
    setBody(skill.body)
  }

  return (
    <main
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-app)',
        borderTopLeftRadius: 'var(--radius-xl)',
        overflow: 'hidden'
      }}
    >
      <nav
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: '24px 28px 0',
          font: 'var(--weight-semibold) var(--text-sm)/1 var(--font-sans)',
          letterSpacing: 'var(--tracking-tight)'
        }}
      >
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onBack()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          Skills
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{title}</span>
      </nav>

      <div className="chatscroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <div
          style={{
            width: '100%',
            /* The same content width the project view uses, so the two sections line up when you
               move between them. */
            maxWidth: 1114,
            margin: '0 auto',
            padding: '38px 28px 64px',
            boxSizing: 'border-box'
          }}
        >
          {/* Title centred in the column, with the actions pinned to the right rather than sharing a
              flex row — a space-between row would shift the title sideways as buttons appear. */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 44,
              margin: '0 0 var(--space-10)'
            }}
          >
            <h1
              style={{
                margin: 0,
                font: 'var(--type-display)',
                color: 'var(--text-primary)',
                letterSpacing: 'var(--tracking-display)',
                textAlign: 'center'
              }}
            >
              {title}
            </h1>
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)'
              }}
            >
              {dirty ? (
                <>
                  <IconButton
                    icon="refresh-cw"
                    label="Sync to Notion"
                    size="sm"
                    onClick={() => void save()}
                    disabled={saving}
                  />
                  <IconButton
                    icon="x"
                    label="Discard changes"
                    size="sm"
                    onClick={discard}
                    disabled={saving}
                  />
                </>
              ) : null}
            </div>
          </div>

          {/* One panelled card, hairline-divided, after the project view's aside: name and mode share
              the first row, then description, then the instructions themselves. */}
          <aside
            style={{
              boxSizing: 'border-box',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              background: 'transparent',
              overflow: 'hidden'
            }}
          >
            {/* Two equal halves with a full-height rule between them. A grid rather than flex with a
                border: the `1px` track stretches to the taller half on its own, and the padding sits
                on each half so the rule reaches the panel's edges. */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1px 1fr',
                borderBottom: '1px solid var(--border-default)'
              }}
            >
              <div style={{ padding: 'var(--space-7)', minWidth: 0 }}>
                  <h3 style={{ ...headingStyle, marginBottom: 'var(--space-3)' }}>Name</h3>
                  {loading ? (
                    <Skeleton height={FIELD_HEIGHT} radius="var(--radius-md)" />
                  ) : (
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={failed}
                      style={{ ...fieldStyle, height: FIELD_HEIGHT }}
                    />
                  )}
              </div>

              <div style={{ background: 'var(--border-default)' }} />

              <div style={{ padding: 'var(--space-7)', minWidth: 0 }}>
                  <h3 style={{ ...headingStyle, marginBottom: 'var(--space-3)' }}>Mode</h3>
                  {loading ? (
                    <Skeleton height={FIELD_HEIGHT} radius="var(--radius-md)" delay={0.08} />
                  ) : (
                    <SegmentedControl
                      fill
                      style={{ height: FIELD_HEIGHT }}
                      value={mode}
                      onChange={(v) => setMode(v as SkillMode)}
                      items={[
                        { value: 'oneshot', label: 'One-shot', icon: 'corner-right-down' },
                        { value: 'persistent', label: 'Persistent', icon: 'pin' }
                      ]}
                    />
                  )}
              </div>
            </div>

            <div style={panelStyle(true)}>
              <h3 style={{ ...headingStyle, marginBottom: 'var(--space-3)' }}>Instructions</h3>
              {loading ? (
                <Skeleton height={260} radius="var(--radius-md)" delay={0.24} />
              ) : (
                <textarea
                  className="chatscroll"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={failed}
                  style={{
                    ...fieldStyle,
                    minHeight: '260px',
                    font: 'var(--weight-regular) var(--text-base)/1.5 var(--font-mono)',
                    resize: 'vertical'
                  }}
                />
              )}
            </div>
          </aside>

          {failed ? (
            <p style={{ ...noteStyle, marginTop: 'var(--space-6)', color: 'var(--text-faint)' }}>
              Could not read this skill from Notion.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  )
}

export default SkillDetailView
