import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { CONTEXT_SEPARATOR } from '@shared/injection'

/* Shows exactly what a project contributes to the CLI's appended system prompt.

   Fetched live rather than cached: the system prompt is reassembled from Notion on every spawn, so
   what this shows is what the next spawn will send — not a snapshot of what was sent before. */

export interface ProjectContextModalProps {
  projectId: string
  title: string
  onClose: () => void
}

export function ProjectContextModal({ projectId, title, onClose }: ProjectContextModalProps): ReactElement {
  const [context, setContext] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api
      .getProjectContext(projectId)
      .then((text) => {
        if (!cancelled) setContext(text)
      })
      .catch((error) => {
        console.error('[chat] getProjectContext failed:', error)
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /* One block per piece — the project's instructions, each context page, each attached chat —
     divided the way `fetchProjectContext` divides them. */
  const pieces = (context ?? '').split(CONTEXT_SEPARATOR).filter((p) => p.trim().length > 0)

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
              Appended to the system prompt
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
          {failed ? 'Could not load this project’s context.' : null}
          {!failed && context === null ? 'Loading…' : null}
          {!failed && context !== null && pieces.length === 0
            ? 'This project has no context yet — nothing is appended for it.'
            : null}
          {pieces.map((piece, i) => (
            <div
              key={i}
              style={
                i === 0
                  ? undefined
                  : { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-default)' }
              }
            >
              {piece}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
