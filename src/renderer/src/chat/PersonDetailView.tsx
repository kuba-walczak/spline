import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton, SkeletonLines } from '@/components/ui/skeleton'
import { blocksToMarkdown } from '@shared/markdown'

/* One person, which is one Notion page and nothing else.

   Read as rendered blocks, and written the way a project's context page is: an edit button swaps the
   rendering for a textarea, and syncing lays the text back down as paragraphs. Editing is behind
   that button rather than always on because saving flattens anything richer than a paragraph — a
   page written in Notion with headings and lists should not lose them just by being looked at.

   Re-read on every selection, so an edit made in Notion shows up without restarting the app. */

interface PersonBlock {
  id: string
  type: string
  text: string
  checked?: boolean
  url?: string
}

interface PersonDetail {
  id: string
  name: string
  lastEdited: string | null
  blocks: PersonBlock[]
}

const bodyStyle: CSSProperties = {
  margin: 0,
  font: 'var(--type-body)',
  color: 'var(--text-body)',
  letterSpacing: 'var(--tracking-tight)',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere'
}

const headingStyle: CSSProperties = {
  margin: 0,
  font: 'var(--type-body-strong)',
  color: 'var(--text-primary)',
  letterSpacing: 'var(--tracking-tight)'
}

const HEADINGS = new Set(['heading_1', 'heading_2', 'heading_3'])
const LIST_ITEMS = new Set(['bulleted_list_item', 'numbered_list_item', 'to_do'])

export interface PersonDetailViewProps {
  personId: string
  /** The list's copy, so the heading is populated before the fetch lands. */
  fallbackName: string
  onBack: () => void
  /** Lets the sidebar list pick up a rename. */
  onSaved: () => void
}

export function PersonDetailView({
  personId,
  fallbackName,
  onBack,
  onSaved
}: PersonDetailViewProps): ReactElement {
  const [person, setPerson] = useState<PersonDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)

    window.api
      .getPerson(personId)
      .then((loaded) => {
        if (cancelled) return
        setPerson(loaded)
        setEditing(false)
      })
      .catch((error) => {
        console.error('[people] getPerson failed:', error)
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [personId])

  const title = person?.name || fallbackName || 'Untitled'
  const blocks = person?.blocks ?? []

  /* Markdown, so structure survives the round trip: a heading edited here is written back as a
     heading. Images and child pages have no spelling and are left out — they are not prose, and
     round-tripping them through a textarea would delete them. */
  const originalBody = blocksToMarkdown(blocks.filter((b) => b.type !== 'child_page' && b.type !== 'image'))

  const dirty = editing && (nameDraft !== (person?.name ?? '') || bodyDraft !== originalBody)

  function startEditing(): void {
    setNameDraft(person?.name ?? '')
    setBodyDraft(originalBody)
    setEditing(true)
  }

  async function sync(): Promise<void> {
    if (saving || !person) return
    setSaving(true)
    try {
      if (nameDraft !== person.name) await window.api.renamePerson(personId, nameDraft)
      if (bodyDraft !== originalBody) await window.api.updatePersonContent(personId, bodyDraft)
      const reloaded = await window.api.getPerson(personId)
      setPerson(reloaded)
      setEditing(false)
      onSaved()
    } catch (error) {
      console.error('[people] save failed:', error)
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
            onBack()
          }}
          style={{ color: 'var(--text-primary)' }}
        >
          People
        </a>
        <span style={{ color: 'var(--text-faint)', fontWeight: 'var(--weight-regular)' }}>/</span>
        <span style={{ color: 'var(--text-primary)' }}>{title}</span>
      </nav>

      <div className="chatscroll" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <div
          style={{
            width: '100%',
            maxWidth: 1114,
            margin: '0 auto',
            padding: '38px 28px 64px',
            boxSizing: 'border-box'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              margin: '0 0 var(--space-10)'
            }}
          >
            {editing ? (
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                style={{
                  flex: '1 1 auto',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  padding: '2px 0',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--border-default)',
                  color: 'var(--text-primary)',
                  font: 'var(--type-title)',
                  letterSpacing: 'var(--tracking-display)',
                  outline: 'none',
                  boxShadow: 'none'
                }}
              />
            ) : (
              <h1
                style={{
                  margin: 0,
                  flex: '1 1 auto',
                  minWidth: 0,
                  font: 'var(--type-title)',
                  color: 'var(--text-primary)',
                  letterSpacing: 'var(--tracking-display)'
                }}
              >
                {/* The name loads with the page, so it waits with it. The list's copy is already
                    known and could be shown straight away, but then the heading would sit finished
                    above a skeleton body and the page would look half-broken rather than loading. */}
                {loading ? <Skeleton height={38} width="42%" /> : title}
              </h1>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flex: '0 0 auto' }}>
              {dirty ? (
                <IconButton
                  icon="refresh-cw"
                  label="Sync to Notion"
                  size="sm"
                  onClick={() => void sync()}
                  disabled={saving}
                />
              ) : null}
              <IconButton
                icon="pencil"
                label={editing ? 'Cancel edit' : 'Edit page'}
                size="sm"
                active={editing}
                disabled={loading || failed}
                onClick={() => (editing ? setEditing(false) : startEditing())}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {loading ? (
              <>
                <SkeletonLines lines={4} />
                <Skeleton height={18} width="40%" delay={0.3} />
                <SkeletonLines lines={3} delay={0.36} />
              </>
            ) : failed ? (
              <span style={{ ...bodyStyle, color: 'var(--text-faint)' }}>
                Couldn&apos;t load this page.
              </span>
            ) : editing ? (
              <textarea
                className="chatscroll"
                value={bodyDraft}
                onChange={(e) => setBodyDraft(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  minHeight: 320,
                  padding: 'var(--space-5)',
                  resize: 'vertical',
                  background: 'var(--surface-inset)',
                  border: '1px solid var(--border-default)',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-body)',
                  font: 'var(--type-body)',
                  letterSpacing: 'var(--tracking-tight)',
                  outline: 'none',
                  boxShadow: 'none'
                }}
              />
            ) : blocks.length === 0 ? (
              <span style={{ ...bodyStyle, color: 'var(--text-faint)' }}>
                This page is empty. Write it in Notion.
              </span>
            ) : (
              blocks.map((block) => {
                if (block.type === 'image' && block.url) {
                  return (
                    <img
                      key={block.id}
                      src={block.url}
                      alt={block.text || ''}
                      style={{ maxWidth: '100%', borderRadius: 'var(--radius-md)', display: 'block' }}
                    />
                  )
                }

                if (block.type === 'divider') {
                  return <hr key={block.id} style={{ border: 'none', borderTop: '1px solid var(--border-default)', margin: 0 }} />
                }

                if (HEADINGS.has(block.type)) {
                  return (
                    <h3 key={block.id} style={headingStyle}>
                      {block.text}
                    </h3>
                  )
                }

                if (LIST_ITEMS.has(block.type)) {
                  const marker = block.type === 'to_do' ? (block.checked ? '☑' : '☐') : '•'
                  return (
                    <p key={block.id} style={{ ...bodyStyle, paddingLeft: 'var(--space-6)' }}>
                      {marker} {block.text}
                    </p>
                  )
                }

                if (block.type === 'code') {
                  return (
                    <pre
                      key={block.id}
                      style={{
                        margin: 0,
                        padding: '14px 16px',
                        background: 'var(--surface-inset)',
                        border: '1px solid var(--border-default)',
                        borderRadius: 'var(--radius-md)',
                        font: 'var(--weight-regular) var(--text-base)/1.5 var(--font-mono)',
                        color: 'var(--text-body)',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere'
                      }}
                    >
                      {block.text}
                    </pre>
                  )
                }

                if (block.type === 'quote') {
                  return (
                    <p
                      key={block.id}
                      style={{
                        ...bodyStyle,
                        paddingLeft: 'var(--space-6)',
                        borderLeft: '2px solid var(--border-default)',
                        color: 'var(--text-muted)'
                      }}
                    >
                      {block.text}
                    </p>
                  )
                }

                return (
                  <p key={block.id} style={bodyStyle}>
                    {block.text}
                  </p>
                )
              })
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

export default PersonDetailView
