import { useState } from 'react'
import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DropdownButton } from '@/components/ui/dropdown-button'
import { IconButton } from '@/components/ui/icon-button'

/* Implementation of `Projects.dc.html` from the Claude app design system.
   Projects live in memory only — the seed list is the design's own sample data. */

interface Project {
  id: number
  title: string
  badge?: string
  body?: string
  meta: string
  order: number
}

const SEED: Project[] = [
  { id: 1, title: 'test', meta: '2 days ago', order: 0 },
  { id: 2, title: 'Career', meta: 'Jul 12', order: 1 },
  {
    id: 3,
    title: 'How to use Claude',
    badge: 'Example project',
    meta: 'Jul 1',
    order: 2,
    body: 'An example project that also doubles as a how-to guide for using Claude. Chat with it to learn more about how to get the most out of chatting with Claude!'
  },
  {
    id: 4,
    title: 'Speech Bridge',
    meta: 'Jul 1',
    order: 3,
    body: 'I want to create a fullstack application where the goal is to take audio input from a device, then transcribe and translate it and display it as captions on the same device with minimal latency.'
  }
]

const SORTS = ['Last updated', 'Name'] as const

export interface ProjectsViewProps {
  /** Cards — show the project description preview. */
  showPreviews?: boolean
  /** Cards — initial sort order. */
  defaultSort?: (typeof SORTS)[number]
}

export default function ProjectsView({
  showPreviews = true,
  defaultSort = 'Last updated'
}: ProjectsViewProps): ReactElement {
  const [items, setItems] = useState<Project[]>(SEED)
  const [sort, setSort] = useState(() => Math.max(0, SORTS.indexOf(defaultSort)))

  const sorted = items
    .slice()
    .sort((a, b) => (sort === 0 ? a.order - b.order : a.title.localeCompare(b.title)))

  function cycleSort(): void {
    setSort((s) => (s + 1) % SORTS.length)
  }

  function newProject(): void {
    const now = Date.now()
    setItems((prev) => [{ id: now, title: 'Untitled project', meta: 'Just now', order: -now }, ...prev])
  }

  return (
    <div
      className="chatscroll"
      style={{
        flex: '1 1 auto',
        minWidth: 0,
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        background: 'var(--surface-app)'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 'var(--container)',
          margin: '0 auto',
          padding: '50px 24px 64px',
          boxSizing: 'border-box'
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-7)',
            marginBottom: 'var(--space-13)'
          }}
        >
          <h2
            style={{
              font: 'var(--type-title)',
              color: 'var(--text-primary)',
              letterSpacing: 'var(--tracking-display)',
              margin: 0
            }}
          >
            Projects
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <IconButton icon="search" label="Search projects" variant="filled" />
            <DropdownButton label="Sort by" value={SORTS[sort]} onClick={cycleSort} />
            <Button variant="primary" onClick={newProject}>
              New project
            </Button>
          </div>
        </header>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 'var(--space-10)',
            alignItems: 'start'
          }}
        >
          {sorted.map((p) => {
            const body = showPreviews ? p.body : undefined
            return (
              <Card
                key={p.id}
                title={p.title}
                badge={p.badge}
                body={body}
                meta={p.meta}
                style={{ minHeight: body ? 160 : 77 }}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
