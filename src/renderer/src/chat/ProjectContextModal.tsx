import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { InjectionModal } from '@/components/ui/injection-modal'
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

  /* One block per piece — the project's instructions, each context page, each attached chat —
     divided the way `fetchProjectContext` divides them. */
  const pieces = (context ?? '').split(CONTEXT_SEPARATOR).filter((p) => p.trim().length > 0)

  return (
    <InjectionModal title={title} subtitle="Appended to the system prompt" onClose={onClose}>
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
    </InjectionModal>
  )
}
