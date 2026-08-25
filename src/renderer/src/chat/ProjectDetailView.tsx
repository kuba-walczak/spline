import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Composer } from '@/components/ui/composer'
import { IconButton } from '@/components/ui/icon-button'

/* Implementation of `Project Detail.dc.html` from the Claude app design system —
   the drill-down from a ProjectsView card.

   The design's panels map onto what a Notion project page actually holds:
     Recents      -> the page's child pages (one per conversation)
     Instructions -> the content of a dedicated "Instructions" child page, if one exists
   Context has no backing data yet, so it renders the design's empty state. */

interface DetailBlock {
  id: string
  type: string
  text: string
  checked?: boolean
  url?: string
}

interface ProjectChatEntry {
  id: string
  name: string
}

interface ProjectDetail {
  id: string
  title: string
  lastEdited: string | null
  instructions: string
  color: string | null
  blocks: DetailBlock[]
  chats: ProjectChatEntry[]
}

/* Panel shell: 16px inset, hairline divider on every section but the last. */
function panelStyle(last = false): CSSProperties {
  return { padding: 'var(--space-7)', borderBottom: last ? 'none' : '1px solid var(--border-default)' }
}

const headingStyle: CSSProperties = {
  margin: 0,
  font: 'var(--type-body-strong)',
  color: 'var(--text-primary)',
  letterSpacing: 'var(--tracking-tight)'
}

const panelBodyStyle: CSSProperties = {
  margin: 0,
  font: 'var(--type-body)',
  color: 'var(--text-muted)',
  letterSpacing: 'var(--tracking-tight)'
}

/* Context — inner pages as small cards. */
function fileTag(title: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(title.trim())
  return (match ? match[1] : 'page').toUpperCase()
}

function ContextCard({
  title,
  badge,
  onOpen
}: {
  title: string
  badge: string
  onOpen: () => void
}): ReactElement {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 125,
        padding: '13px 14px 12px',
        boxSizing: 'border-box',
        background: hover ? '#282826' : '#212120',
        border: `1px solid ${hover ? '#3a3a38' : '#2b2b29'}`,
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'var(--transition-control)'
      }}
    >
      <span
        style={{
          font: 'var(--weight-semibold) 13px/1.35 var(--font-sans)',
          color: 'var(--text-primary)',
          letterSpacing: 'var(--tracking-tight)',
          wordBreak: 'break-word'
        }}
      >
        {title}
      </span>
      <span style={{ flex: '1 1 auto' }} />
      <span
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          height: 20,
          padding: '0 7px',
          background: '#2e2e2c',
          border: '1px solid #3a3a38',
          borderRadius: 4,
          color: 'var(--text-body)',
          font: 'var(--weight-medium) 11px/1 var(--font-sans)',
          letterSpacing: 'var(--tracking-tight)'
        }}
      >
        {badge}
      </span>
    </div>
  )
}

interface ContextCardItem {
  id: string
  title: string
  badge: string
  onOpen: () => void
}

function ContextCards({ items }: { items: ContextCardItem[] }): ReactElement {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, 152px)',
        justifyContent: 'start',
        gap: 12
      }}
    >
      {items.map((item) => (
        <ContextCard key={item.id} title={item.title} badge={item.badge} onOpen={item.onOpen} />
      ))}
    </div>
  )
}

/* The Context empty state: three stacked paper cards, the front one badged with a +. */
function ContextPlaceholder(): ReactElement {
  const line = (width: string, opacity: number): ReactElement => (
    <div style={{ height: 1, width, background: 'var(--bone-500)', opacity }} />
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-9)',
        padding: '34px 28px',
        /* One notch below the sidebar plate — no token for this well. */
        background: '#141413',
        borderRadius: 'var(--radius-md)'
      }}
    >
      <div style={{ position: 'relative', width: 118, height: 52 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 2,
            width: 34,
            height: 24,
            padding: 5,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            background: 'var(--surface-control)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            transform: 'rotate(-4deg)'
          }}
        >
          {line('100%', 0.5)}
          {line('70%', 0.5)}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 60,
            top: 0,
            width: 38,
            height: 44,
            padding: 6,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            background: 'var(--surface-control)',
            border: '1px solid var(--border-strong)',
            borderRadius: 4,
            transform: 'rotate(5deg)'
          }}
        >
          {line('100%', 0.5)}
          {line('100%', 0.5)}
          {line('60%', 0.5)}
          {line('100%', 0.5)}
        </div>
        <div
          style={{
            position: 'absolute',
            left: 30,
            bottom: 0,
            width: 40,
            height: 32,
            padding: 6,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            background: 'var(--surface-thumb)',
            border: '1px solid var(--border-inset)',
            borderRadius: 4
          }}
        >
          {line('100%', 0.6)}
          {line('65%', 0.6)}
          <div
            style={{
              position: 'absolute',
              right: -6,
              bottom: -6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 16,
              height: 16,
              background: 'var(--surface-thumb)',
              border: '1px solid var(--border-inset)',
              borderRadius: '50%',
              color: 'var(--text-body)',
              font: 'var(--weight-medium) 11px/1 var(--font-sans)'
            }}
          >
            +
          </div>
        </div>
      </div>
      <p style={{ ...panelBodyStyle, maxWidth: 220, textAlign: 'center' }}>
        Add PDFs, documents, or other text to reference in this project.
      </p>
    </div>
  )
}

const BLOCK_TAG: Record<string, string | undefined> = {
  heading_1: 'h3',
  heading_2: 'h4',
  heading_3: 'h4',
  bulleted_list_item: 'li',
  numbered_list_item: 'li',
  to_do: 'li'
}

/** Flattens a page's text blocks down to plain lines — the shape an edit textarea round-trips through. */
function blocksToText(blocks: DetailBlock[]): string {
  return blocks
    .filter((b) => b.type !== 'child_page' && b.type !== 'image')
    .map((b) => b.text)
    .join('\n')
}

const editTextareaStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 120,
  padding: 'var(--space-5)',
  resize: 'vertical',
  background: 'var(--surface-control)',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-body)',
  font: 'var(--type-body)',
  letterSpacing: 'var(--tracking-tight)',
  outline: 'none',
  boxShadow: 'none'
}

/* Full-page context view — replaces the project overview, in place of a modal. */
function ContextPageView({
  projectTitle,
  detail,
  loading,
  error,
  onBackToProjects,
  onBackToProject,
  onSave
}: {
  projectTitle: string
  detail: ProjectDetail | null
  loading: boolean
  error: boolean
  onBackToProjects: () => void
  onBackToProject: () => void
  onSave: (text: string) => Promise<void>
}): ReactElement {
  const blocks = detail?.blocks.filter((b) => b.type !== 'child_page') ?? []
  const title = detail?.title || 'Untitled'

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const original = blocksToText(blocks)
  const dirty = draft !== original

  function startEditing(): void {
    setDraft(original)
    setEditing(true)
  }

  async function sync(): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (err) {
      console.error('[project] updateContextPageContent failed:', err)
    } finally {
      setSaving(false)
    }
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
            onBackToProjects()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          Projects
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onBackToProject()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          {projectTitle}
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{title}</span>
      </nav>

      <div
        className="chatscroll"
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
      <div
        style={{
          width: '100%',
          maxWidth: 1114,
          margin: '0 auto',
          padding: '38px 28px 64px',
          boxSizing: 'border-box'
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-10)',
            marginBottom: 'var(--space-10)'
          }}
        >
          <h1
            style={{
              margin: 0,
              font: 'var(--type-title)',
              color: 'var(--text-primary)',
              letterSpacing: 'var(--tracking-display)'
            }}
          >
            {title}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flex: '0 0 auto', paddingTop: 4 }}>
            {editing && dirty ? (
              <IconButton icon="refresh-cw" label="Sync to Notion" size="sm" onClick={() => void sync()} disabled={saving} />
            ) : null}
            <IconButton
              icon="pencil"
              label={editing ? 'Cancel edit' : 'Edit page'}
              size="sm"
              active={editing}
              onClick={() => (editing ? setEditing(false) : startEditing())}
            />
          </div>
        </header>

        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={editTextareaStyle}
            autoFocus
          />
        ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {loading ? (
            <span style={panelBodyStyle}>Loading…</span>
          ) : error ? (
            <span style={panelBodyStyle}>Couldn&apos;t load this page.</span>
          ) : blocks.length === 0 ? (
            <span style={panelBodyStyle}>This page is empty.</span>
          ) : (
            blocks.map((b) => {
              if (b.type === 'image' && b.url) {
                return (
                  <img
                    key={b.id}
                    src={b.url}
                    alt={b.text || ''}
                    style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)', display: 'block' }}
                  />
                )
              }
              const tag = BLOCK_TAG[b.type]
              const text = b.type === 'to_do' ? `${b.checked ? '☑' : '☐'} ${b.text}` : b.text
              if (tag === 'h3' || tag === 'h4') {
                return (
                  <h3 key={b.id} style={{ ...headingStyle, margin: 0 }}>
                    {text}
                  </h3>
                )
              }
              if (tag === 'li') {
                return (
                  <p key={b.id} style={{ ...panelBodyStyle, margin: 0, paddingLeft: 'var(--space-6)' }}>
                    {text}
                  </p>
                )
              }
              return (
                <p key={b.id} style={{ ...panelBodyStyle, margin: 0 }}>
                  {text}
                </p>
              )
            })
          )}
        </div>
        )}
      </div>
      </div>
    </main>
  )
}

const titleInputStyle: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '4px 0',
  background: 'transparent',
  border: 'none',
  borderBottom: '1px solid var(--border-default)',
  outline: 'none',
  boxShadow: 'none',
  color: 'var(--text-primary)',
  font: 'var(--type-title)',
  letterSpacing: 'var(--tracking-display)'
}

/** Full-page "new context" view — an empty page the user titles and writes before it exists in Notion. */
function NewContextPageView({
  projectTitle,
  onBackToProjects,
  onBackToProject,
  onCreate
}: {
  projectTitle: string
  onBackToProjects: () => void
  onBackToProject: () => void
  onCreate: (title: string, text: string) => Promise<void>
}): ReactElement {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  async function sync(): Promise<void> {
    if (saving || !title.trim()) return
    setSaving(true)
    try {
      await onCreate(title.trim(), text)
    } catch (err) {
      console.error('[project] createContextPage failed:', err)
    } finally {
      setSaving(false)
    }
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
            onBackToProjects()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          Projects
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault()
            onBackToProject()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          {projectTitle}
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{title || 'Untitled'}</span>
      </nav>

      <div
        className="chatscroll"
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
      <div
        style={{
          width: '100%',
          maxWidth: 1114,
          margin: '0 auto',
          padding: '38px 28px 64px',
          boxSizing: 'border-box'
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-10)',
            marginBottom: 'var(--space-10)'
          }}
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled"
            style={titleInputStyle}
            autoFocus
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flex: '0 0 auto' }}>
            <IconButton
              icon="refresh-cw"
              label="Sync to Notion"
              size="sm"
              onClick={() => void sync()}
              disabled={saving || !title.trim()}
            />
          </div>
        </header>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write the content for this page…"
          style={editTextareaStyle}
        />
      </div>
      </div>
    </main>
  )
}

export interface ProjectDetailViewProps {
  projectId: string
  onBack: () => void
  onColorChange?: (projectId: string, color: string) => void
  onOpenChat: (chatId: string) => void
}

const DEFAULT_COLOR = '#151515'

export default function ProjectDetailView({
  projectId,
  onBack,
  onColorChange,
  onOpenChat
}: ProjectDetailViewProps): ReactElement {
  const [detail, setDetail] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [openContextId, setOpenContextId] = useState<string | null>(null)
  const [creatingContext, setCreatingContext] = useState(false)
  const [contextDetail, setContextDetail] = useState<ProjectDetail | null>(null)
  const [contextLoading, setContextLoading] = useState(false)
  const [contextError, setContextError] = useState(false)
  const [editingInstructions, setEditingInstructions] = useState(false)
  const [instructionsDraft, setInstructionsDraft] = useState('')
  const [savingInstructions, setSavingInstructions] = useState(false)
  const [colorDraft, setColorDraft] = useState<string | null>(null)
  const [savingColor, setSavingColor] = useState(false)

  function loadContext(id: string): void {
    setContextLoading(true)
    setContextError(false)
    window.api
      .getProjectDetail(id)
      .then((d) => setContextDetail(d))
      .catch((err) => {
        console.error('[project] getProjectDetail (context) failed:', err)
        setContextError(true)
      })
      .finally(() => setContextLoading(false))
  }

  useEffect(() => {
    if (!openContextId) return
    setContextDetail(null)
    loadContext(openContextId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openContextId])

  function load(): void {
    setLoading(true)
    setError(false)
    window.api
      .getProjectDetail(projectId)
      .then((d) => setDetail(d))
      .catch((err) => {
        console.error('[project] getProjectDetail failed:', err)
        setError(true)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  async function addNote(): Promise<void> {
    const text = draft.trim()
    if (!text || saving) return
    setSaving(true)
    try {
      await window.api.appendProjectNote(projectId, text)
      setDraft('')
      load()
    } catch (err) {
      console.error('[project] appendProjectNote failed:', err)
    } finally {
      setSaving(false)
    }
  }

  async function syncInstructions(): Promise<void> {
    if (savingInstructions) return
    setSavingInstructions(true)
    try {
      await window.api.updateProjectInstructions(projectId, instructionsDraft)
      setDetail((d) => (d ? { ...d, instructions: instructionsDraft } : d))
      setEditingInstructions(false)
    } catch (err) {
      console.error('[project] updateProjectInstructions failed:', err)
    } finally {
      setSavingInstructions(false)
    }
  }

  async function syncColor(next: string): Promise<void> {
    if (savingColor) return
    setSavingColor(true)
    try {
      await window.api.updateProjectColor(projectId, next)
      setDetail((d) => (d ? { ...d, color: next } : d))
      setColorDraft(null)
      onColorChange?.(projectId, next)
    } catch (err) {
      console.error('[project] updateProjectColor failed:', err)
    } finally {
      setSavingColor(false)
    }
  }

  const blocks = detail?.blocks ?? []
  const recents = blocks.filter((b) => b.type === 'child_page')
  const chats = detail?.chats ?? []
  const contextItems: ContextCardItem[] = recents
    .map((p) => ({
      id: p.id,
      title: p.text || 'Untitled',
      badge: fileTag(p.text || 'Untitled'),
      onOpen: () => setOpenContextId(p.id)
    }))
    .concat(
      chats.map((c) => ({
        id: c.id,
        title: c.name || 'Untitled',
        badge: 'CHAT',
        onOpen: () => onOpenChat(c.id)
      }))
    )
  const instructions = detail?.instructions ?? ''
  const color = colorDraft ?? detail?.color ?? DEFAULT_COLOR
  const colorDirty = colorDraft !== null && colorDraft !== detail?.color

  const title = detail?.title || 'Untitled'
  const emptyStyle: CSSProperties = {
    font: 'var(--type-body)',
    color: 'var(--text-faint)',
    letterSpacing: 'var(--tracking-tight)'
  }

  if (creatingContext) {
    return (
      <NewContextPageView
        projectTitle={title}
        onBackToProjects={onBack}
        onBackToProject={() => setCreatingContext(false)}
        onCreate={async (newTitle, text) => {
          const id = await window.api.createContextPage(projectId, newTitle, text)
          load()
          setCreatingContext(false)
          setOpenContextId(id)
        }}
      />
    )
  }

  if (openContextId) {
    return (
      <ContextPageView
        projectTitle={title}
        detail={contextDetail}
        loading={contextLoading}
        error={contextError}
        onBackToProjects={onBack}
        onBackToProject={() => setOpenContextId(null)}
        onSave={async (text) => {
          await window.api.updateContextPageContent(openContextId, text)
          loadContext(openContextId)
        }}
      />
    )
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
          Projects
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{title}</span>
      </nav>

      <div
        className="chatscroll"
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
      <div
        style={{
          width: '100%',
          maxWidth: 1114,
          margin: '0 auto',
          padding: '38px 28px 64px',
          boxSizing: 'border-box'
        }}
      >
        <h1
          style={{
            margin: '0 0 var(--space-10)',
            font: 'var(--type-title)',
            color: 'var(--text-primary)',
            letterSpacing: 'var(--tracking-display)'
          }}
        >
          {title}
        </h1>

        <div className="pdgrid">
          <section style={{ minWidth: 0 }}>
            <Composer
              value={draft}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void addNote()
                }
              }}
              placeholder="Write a message…"
              model="Opus 5"
              effort="High"
              /* Same shell as the chat view's composer. */
              style={{ maxWidth: 'var(--container)', minHeight: '104px' }}
            />

          </section>

          <aside
            style={{
              boxSizing: 'border-box',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              background: 'transparent',
              overflow: 'hidden'
            }}
          >
            <div style={panelStyle()}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-6)',
                  marginBottom: 'var(--space-3)'
                }}
              >
                <h3 style={headingStyle}>Color</h3>
                {colorDirty ? (
                  <IconButton
                    icon="refresh-cw"
                    label="Sync to Notion"
                    size="sm"
                    onClick={() => void syncColor(color)}
                    disabled={savingColor}
                  />
                ) : null}
              </div>
              <label
                style={{
                  display: 'block',
                  width: '100%',
                  height: 28,
                  boxSizing: 'border-box',
                  borderRadius: 'var(--radius-sm)',
                  background: color,
                  border: '1px solid var(--border-default)',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColorDraft(e.target.value)}
                  style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}
                />
              </label>
            </div>

            <div style={panelStyle()}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-6)',
                  marginBottom: 'var(--space-3)'
                }}
              >
                <h3 style={headingStyle}>Instructions</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  {editingInstructions && instructionsDraft !== instructions ? (
                    <IconButton
                      icon="refresh-cw"
                      label="Sync to Notion"
                      size="sm"
                      onClick={() => void syncInstructions()}
                      disabled={savingInstructions}
                    />
                  ) : null}
                  <IconButton
                    icon="pencil"
                    label={editingInstructions ? 'Cancel edit' : 'Edit instructions'}
                    size="sm"
                    active={editingInstructions}
                    onClick={() => {
                      if (editingInstructions) {
                        setEditingInstructions(false)
                      } else {
                        setInstructionsDraft(instructions)
                        setEditingInstructions(true)
                      }
                    }}
                  />
                </div>
              </div>
              {editingInstructions ? (
                <textarea
                  value={instructionsDraft}
                  onChange={(e) => setInstructionsDraft(e.target.value)}
                  style={editTextareaStyle}
                  autoFocus
                />
              ) : (
                <p className="pdclamp" style={panelBodyStyle}>
                  {instructions || 'No instructions yet.'}
                </p>
              )}
            </div>

            <div style={panelStyle(true)}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'var(--space-6)',
                  marginBottom: 'var(--space-6)'
                }}
              >
                <h3 style={headingStyle}>Context</h3>
                <IconButton icon="plus" label="Add context" size="sm" onClick={() => setCreatingContext(true)} />
              </div>
              {loading ? (
                <span style={emptyStyle}>Loading…</span>
              ) : error ? (
                <span style={emptyStyle}>Couldn&apos;t load this project.</span>
              ) : contextItems.length === 0 ? (
                <ContextPlaceholder />
              ) : (
                <ContextCards items={contextItems} />
              )}
            </div>
          </aside>
        </div>
      </div>
      </div>
    </main>
  )
}
