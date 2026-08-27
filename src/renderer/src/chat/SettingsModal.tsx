import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'

/* Implementation of `Settings.dc.html` from the Claude app design system,
   scoped down to a single "Prompt" tab per the current spec.

   The textbox round-trips through Notion the same way Instructions/Context do
   elsewhere in the app: draft state, dirty check against the loaded value,
   explicit sync via the refresh-cw button. Stored as TITLE.md under the Config
   page (see NotionService.fetch/saveTitleMarkdown). */

export interface SettingsModalProps {
  onClose: () => void
}

export function SettingsModal({ onClose }: SettingsModalProps): ReactElement {

  const [titleOriginal, setTitleOriginal] = useState('')
  const [titleDraft, setTitleDraft] = useState('')
  const [titleLoading, setTitleLoading] = useState(true)
  const [titleSaving, setTitleSaving] = useState(false)
  const titleDirty = titleDraft !== titleOriginal

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
          <button
            type="button"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              width: '100%',
              height: '33px',
              padding: '0 11px',
              boxSizing: 'border-box',
              border: 'none',
              cursor: 'default',
              textAlign: 'left',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--surface-hover)',
              color: 'var(--text-primary)'
            }}
          >
            <Icon name="corner-right-down" size={16} />
            <span
              style={{
                font: 'var(--weight-semibold) var(--text-base)/1 var(--font-sans)',
                letterSpacing: 'var(--tracking-tight)'
              }}
            >
              Injection
            </span>
          </button>
        </nav>

        <div style={{ position: 'relative', flex: '1 1 auto', minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column', background: '#1a1a19' }}>
          <div style={{ position: 'absolute', top: '14px', right: '14px', zIndex: 2 }}>
            <IconButton icon="x" label="Close settings" glyphSize={18} onClick={onClose} />
          </div>

          <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', padding: '52px 34px 40px', boxSizing: 'border-box' }}>
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
          </div>
        </div>
      </div>
    </div>
  )
}
