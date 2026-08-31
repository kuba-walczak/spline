import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { blocksToMarkdown } from '@shared/markdown'

/* One person: a row in the People table and the page under it.

   Laid out the way a skill is, because a person is now the same shape — a name, a column beside it,
   and a body. The name and the affiliation are the row's columns; the description is the page, read
   as markdown and written back the same way.

   Editing is always on, as it is for a skill, rather than behind a pencil. Nothing is written until
   Sync, and `dirty` compares the drafts against what Notion gave us — so opening a person and
   reading them writes nothing, and the flattening that a save does to anything richer than the
   markdown carries only happens when you actually meant to save.

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
  affiliation: string
  lastEdited: string | null
  blocks: PersonBlock[]
}

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

/** Shared by the two fields on the split row, so they sit level. */
const FIELD_HEIGHT = 42

const noteStyle: CSSProperties = {
  margin: '0 0 12px',
  font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
  letterSpacing: 'var(--tracking-tight)',
  color: 'var(--text-muted)'
}

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

  const [name, setName] = useState('')
  const [affiliation, setAffiliation] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)

  /* Markdown, so structure survives the round trip: a heading edited here is written back as a
     heading. Images are in it as `![caption](url)`, since the draft is the whole of what the page is
     rewritten from and anything missing from it is deleted on save. Child pages are left out — a
     page inside this one is not part of its body. */
  const toMarkdown = (loaded: PersonDetail): string =>
    blocksToMarkdown(loaded.blocks.filter((b) => b.type !== 'child_page'))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)

    window.api
      .getPerson(personId)
      .then((loaded) => {
        if (cancelled) return
        setPerson(loaded)
        setName(loaded.name)
        setAffiliation(loaded.affiliation)
        setBody(toMarkdown(loaded))
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
  const ready = person !== null && !loading && !failed
  const originalBody = person ? toMarkdown(person) : ''
  const dirty =
    ready && (name !== person.name || affiliation !== person.affiliation || body !== originalBody)

  async function save(): Promise<void> {
    if (saving || !dirty || !person) return
    setSaving(true)
    try {
      if (name !== person.name) await window.api.renamePerson(personId, name)
      if (affiliation !== person.affiliation) {
        await window.api.updatePersonAffiliation(personId, affiliation)
      }
      if (body !== originalBody) await window.api.updatePersonContent(personId, body)

      /* Re-read rather than patching what we held: the body comes back as Notion actually laid it
         down, which is what the next dirty check has to compare against. */
      const reloaded = await window.api.getPerson(personId)
      setPerson(reloaded)
      setName(reloaded.name)
      setAffiliation(reloaded.affiliation)
      setBody(toMarkdown(reloaded))
      onSaved()
    } catch (error) {
      console.error('[people] save failed:', error)
    } finally {
      setSaving(false)
    }
  }

  /** Throws the unsynced edits away, back to what Notion last gave us. */
  function discard(): void {
    if (!person) return
    setName(person.name)
    setAffiliation(person.affiliation)
    setBody(toMarkdown(person))
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
            /* The same content width the project and skill views use, so the sections line up when
               you move between them. */
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

          {/* One panelled card, hairline-divided, after the skill view's: name and affiliation share
              the first row — the two columns the row carries — then the page itself below them. */}
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
                <h3 style={{ ...headingStyle, marginBottom: 'var(--space-3)' }}>Affiliation</h3>
                {loading ? (
                  <Skeleton height={FIELD_HEIGHT} radius="var(--radius-md)" delay={0.08} />
                ) : (
                  <input
                    value={affiliation}
                    onChange={(e) => setAffiliation(e.target.value)}
                    disabled={failed}
                    style={{ ...fieldStyle, height: FIELD_HEIGHT }}
                  />
                )}
              </div>
            </div>

            <div style={{ padding: 'var(--space-7)' }}>
              <h3 style={{ ...headingStyle, marginBottom: 'var(--space-3)' }}>Description</h3>
              {loading ? (
                <Skeleton height={260} radius="var(--radius-md)" delay={0.24} />
              ) : (
                <textarea
                  className="chatscroll"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={failed}
                  placeholder="What is worth knowing about them. Written in Notion or here."
                  style={{ ...fieldStyle, minHeight: '260px', resize: 'vertical' }}
                />
              )}
            </div>
          </aside>

          {failed ? (
            <p style={{ ...noteStyle, marginTop: 'var(--space-6)', color: 'var(--text-faint)' }}>
              Could not read this person from Notion.
            </p>
          ) : null}
        </div>
      </div>
    </main>
  )
}

export default PersonDetailView
