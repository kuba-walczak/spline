import { useEffect } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { IconButton } from './icon-button'

/* The shell for "here is exactly what this adds to the prompt" — a project's assembled context, a
   skill's body. Both answer the same question about different things, so they share a frame: same
   dimmed backdrop, same header, same monospaced body, same Escape.

   Only the chrome lives here. What the text is, and how it is divided, belongs to whoever opens
   it. */

export interface InjectionModalProps {
  title: string
  /** The line under the title: where this text lands, in the model's terms. */
  subtitle: string
  onClose: () => void
  children: ReactNode
}

export function InjectionModal({ title, subtitle, onClose, children }: InjectionModalProps): ReactElement {
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px'
      }}
    >
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(10, 10, 9, 0.66)' }} />

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '760px',
          maxHeight: '100%',
          overflow: 'hidden',
          background: 'var(--surface-subtle)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-overlay)'
        }}
      >
        <header
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            padding: '18px 20px',
            borderBottom: '1px solid var(--border-default)'
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                font: 'var(--weight-medium) var(--text-base)/1.2 var(--font-sans)',
                letterSpacing: 'var(--tracking-tight)',
                color: 'var(--text-body)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {title}
            </div>
            <div
              style={{
                marginTop: '3px',
                font: 'var(--type-meta)',
                letterSpacing: 'var(--tracking-tight)',
                color: 'var(--text-faint)'
              }}
            >
              {subtitle}
            </div>
          </div>
          <div style={{ flex: '0 0 auto' }}>
            <IconButton icon="x" label={`Close ${title}`} glyphSize={18} onClick={onClose} />
          </div>
        </header>

        <div
          className="chatscroll"
          style={{
            flex: '1 1 auto',
            overflowY: 'auto',
            padding: '18px 20px',
            color: 'var(--text-body)',
            font: 'var(--weight-regular) var(--text-base)/1.5 var(--font-mono)',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere'
          }}
        >
          {children}
        </div>
      </div>
    </div>
  )
}
