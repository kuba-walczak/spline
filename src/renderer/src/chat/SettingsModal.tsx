import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { formatPollSeconds, MAX_POLL_SECONDS, MIN_POLL_SECONDS } from '@/lib/pollInterval'

/* Implementation of `Settings.dc.html` from the Claude app design system,
   scoped down to a single "Prompt" tab per the current spec.

   The textbox round-trips through Notion the same way Instructions/Context do
   elsewhere in the app: draft state, dirty check against the loaded value,
   explicit sync via the refresh-cw button. Stored as TITLE.md under the Config
   page (see NotionService.fetch/saveTitleMarkdown). */

export interface SettingsModalProps {
  onClose: () => void
  /** Called after SYSTEM.md is saved, so chats rebuild their system prompt from the new text. */
  onSystemPromptSaved: () => void
  /** Whether tool groups start expanded. */
  expandTools: boolean
  onExpandToolsChange: (value: boolean) => void
  /** How often the sidebar's last-active labels are recomputed. */
  pollSeconds: number
  onPollSecondsChange: (seconds: number) => void
}

type SettingsTab = 'general' | 'injection' | 'poll'

const TABS: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'injection', label: 'Injection', icon: 'corner-right-down' },
  { id: 'poll', label: 'Poll', icon: 'refresh-cw' }
]

/** Track-and-knob toggle. Rendered as a real checkbox so it is keyboard-reachable and announced as
    a switch, with the input itself hidden behind the drawn control. */
function Switch({
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

export function SettingsModal({
  onClose,
  onSystemPromptSaved,
  expandTools,
  onExpandToolsChange,
  pollSeconds,
  onPollSecondsChange
}: SettingsModalProps): ReactElement {
  const [tab, setTab] = useState<SettingsTab>('general')

  const [systemOriginal, setSystemOriginal] = useState('')
  const [systemDraft, setSystemDraft] = useState('')
  const [systemLoading, setSystemLoading] = useState(true)
  const [systemSaving, setSystemSaving] = useState(false)
  const systemDirty = systemDraft !== systemOriginal

  const [titleOriginal, setTitleOriginal] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [titleLoading, setTitleLoading] = useState(true)
  const [titleSaving, setTitleSaving] = useState(false)
  const titleDirty = titleDraft !== titleOriginal

  useEffect(() => {
    window.api
      .getSystemMarkdown()
      .then((text) => {
        setSystemOriginal(text)
        setSystemDraft(text)
      })
      .catch((err) => console.error('[settings] getSystemMarkdown failed:', err))
      .finally(() => setSystemLoading(false))
  }, [])

  async function syncSystem(): Promise<void> {
    if (systemSaving || !systemDirty) return
    setSystemSaving(true)
    try {
      await window.api.saveSystemMarkdown(systemDraft)
      setSystemOriginal(systemDraft)
      onSystemPromptSaved()
    } catch (err) {
      console.error('[settings] saveSystemMarkdown failed:', err)
    } finally {
      setSystemSaving(false)
    }
  }

  useEffect(() => {
    window.api
      .getTitleMarkdown()
      .then((text) => {
        setTitleOriginal(text)
        setTitleDraft(text)
      })
      .catch((err) => console.error('[settings] getTitleMarkdown failed:', err))
      .finally(() => setTitleLoading(false))
  }, [])


  async function syncTitle(): Promise<void> {
    if (titleSaving || !titleDirty) return
    setTitleSaving(true)
    try {
      await window.api.saveTitleMarkdown(titleDraft)
      setTitleOriginal(titleDraft)
    } catch (err) {
      console.error('[settings] saveTitleMarkdown failed:', err)
    } finally {
      setTitleSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(10, 10, 9, 0.66)' }}
      />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: '100%',
          maxWidth: '975px',
          height: '100%',
          maxHeight: '720px',
          overflow: 'hidden',
          background: 'var(--surface-subtle)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-overlay)'
        }}
      >
        <nav
          style={{
            flex: '0 0 auto',
            display: 'flex',
            flexDirection: 'column',
            width: '200px',
            height: '100%',
            padding: '20px 12px 24px',
            boxSizing: 'border-box',
            background: '#151515',
            borderRight: '1px solid var(--border-default)'
          }}
        >
          <span
            style={{
              padding: '0 11px',
              marginBottom: '8px',
              font: 'var(--weight-regular) var(--text-sm)/1 var(--font-sans)',
              letterSpacing: 'var(--tracking-tight)',
              color: 'var(--text-muted)'
            }}
          >
            Settings
          </span>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                width: '100%',
                height: '33px',
                padding: '0 11px',
                boxSizing: 'border-box',
                border: 'none',
                cursor: 'pointer',
                textAlign: 'left',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: tab === entry.id ? 'var(--surface-hover)' : 'transparent',
                color: tab === entry.id ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'var(--transition-control)'
              }}
            >
              <Icon name={entry.icon} size={16} />
              <span
                style={{
                  font: `var(--weight-${tab === entry.id ? 'semibold' : 'regular'}) var(--text-base)/1 var(--font-sans)`,
                  letterSpacing: 'var(--tracking-tight)'
                }}
              >
                {entry.label}
              </span>
            </button>
          ))}
        </nav>

        <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a19' }}>
          <div style={{ position: 'absolute', top: '14px', right: '14px', zIndex: 2 }}>
            <IconButton icon="x" label="Close settings" glyphSize={18} onClick={onClose} />
          </div>

          <div
            className="chatscroll"
            style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '52px 34px 40px', boxSizing: 'border-box' }}
          >
            {tab === 'general' ? (
              <>
                <h2
                  style={{
                    margin: '0 0 8px',
                    font: 'var(--weight-semibold) var(--text-lg)/1.3 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-primary)'
                  }}
                >
                  Tool details
                </h2>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '24px',
                    maxWidth: '710px',
                    padding: '14px 16px',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)'
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        font: 'var(--weight-medium) var(--text-base)/1.3 var(--font-sans)',
                        letterSpacing: 'var(--tracking-tight)',
                        color: 'var(--text-body)'
                      }}
                    >
                      Expand by default
                    </div>
                    <div
                      style={{
                        marginTop: '3px',
                        font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
                        letterSpacing: 'var(--tracking-tight)',
                        color: 'var(--text-muted)'
                      }}
                    >
                      Show what each tool was asked and what it returned, without opening it. Applies to
                      chats as they load and to tools used live. Individual groups can still be collapsed.
                    </div>
                  </div>
                  <Switch
                    checked={expandTools}
                    onChange={onExpandToolsChange}
                    label="Expand tool details by default"
                  />
                </div>
              </>
            ) : tab === 'injection' ? (
              <>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                    margin: '0 0 8px',
                    maxWidth: '710px'
                  }}
                >
                  <h2
                    style={{
                      margin: 0,
                      font: 'var(--weight-semibold) var(--text-lg)/1.3 var(--font-sans)',
                      letterSpacing: 'var(--tracking-tight)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    System
                  </h2>
                  {systemDirty ? (
                    <IconButton
                      icon="refresh-cw"
                      label="Sync to Notion"
                      size="sm"
                      onClick={() => void syncSystem()}
                      disabled={systemSaving}
                    />
                  ) : null}
                </div>
                <p
                  style={{
                    margin: '0 0 20px',
                    maxWidth: '710px',
                    font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-muted)'
                  }}
                >
                  Appended to every chat's system prompt, ahead of any project context.
                </p>
                <textarea
                  value={systemDraft}
                  onChange={(e) => setSystemDraft(e.target.value)}
                  placeholder={systemLoading ? 'Loading…' : ''}
                  disabled={systemLoading}
                  style={{
                    width: '100%',
                    maxWidth: '710px',
                    minHeight: '140px',
                    boxSizing: 'border-box',
                    padding: '14px 16px',
                    background: 'var(--surface-inset)',
                    border: '1px solid var(--border-default)',
                    borderRadius: 'var(--radius-md)',
                    color: 'var(--text-body)',
                    font: 'var(--weight-regular) var(--text-base)/1.5 var(--font-mono)',
                    resize: 'vertical',
                    outline: 'none',
                    boxShadow: 'none'
                  }}
                />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  margin: '32px 0 8px',
                  maxWidth: '710px'
                }}
              >
                <h2
                  style={{
                    margin: 0,
                    font: 'var(--weight-semibold) var(--text-lg)/1.3 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-primary)'
                  }}
                >
                  Title
                </h2>
                {titleDirty ? (
                  <IconButton
                    icon="refresh-cw"
                    label="Sync to Notion"
                    size="sm"
                    onClick={() => void syncTitle()}
                    disabled={titleSaving}
                  />
                ) : null}
              </div>
              <p
                style={{
                  margin: '0 0 20px',
                  font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
                  letterSpacing: 'var(--tracking-tight)',
                  color: 'var(--text-muted)'
                }}
              >
                The prompt sent when generating a chat's title.
              </p>
              <textarea
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                placeholder={titleLoading ? 'Loading…' : ''}
                disabled={titleLoading}
                style={{
                  width: '100%',
                  maxWidth: '710px',
                  minHeight: '160px',
                  boxSizing: 'border-box',
                  padding: '14px 16px',
                  background: 'var(--surface-inset)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-body)',
                  font: 'var(--weight-regular) var(--text-base)/1.5 var(--font-mono)',
                  resize: 'vertical',
                  outline: 'none',
                  boxShadow: 'none'
                }}
              />
              </>
            ) : (
              <>
                <h2
                  style={{
                    margin: '32px 0 8px',
                    font: 'var(--weight-semibold) var(--text-lg)/1.3 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-primary)'
                  }}
                >
                  Refresh rate
                </h2>
                <p
                  style={{
                    margin: '0 0 24px',
                    maxWidth: '710px',
                    font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-muted)'
                  }}
                >
                  How often the sidebar&rsquo;s &ldquo;last active&rdquo; labels are recalculated. A chat&rsquo;s
                  timestamp is read when the app starts and updated the moment you send a message &mdash; this only
                  decides how promptly the wording catches up with the clock.
                </p>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '18px',
                    maxWidth: '710px'
                  }}
                >
                  <input
                    type="range"
                    min={MIN_POLL_SECONDS}
                    max={MAX_POLL_SECONDS}
                    step={30}
                    value={pollSeconds}
                    onChange={(e) => onPollSecondsChange(Number(e.target.value))}
                    aria-label="Refresh rate in seconds"
                    style={{ flex: '1 1 auto', accentColor: '#E6E5E2', cursor: 'pointer' }}
                  />
                  <span
                    style={{
                      flex: '0 0 auto',
                      minWidth: '92px',
                      textAlign: 'right',
                      font: 'var(--weight-medium) var(--text-base)/1 var(--font-mono)',
                      letterSpacing: 'var(--tracking-tight)',
                      color: 'var(--text-body)'
                    }}
                  >
                    {formatPollSeconds(pollSeconds)}
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    maxWidth: '710px',
                    marginTop: '8px',
                    paddingRight: '110px',
                    font: 'var(--type-meta)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-faint)'
                  }}
                >
                  <span>30 seconds</span>
                  <span>1 hour</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
