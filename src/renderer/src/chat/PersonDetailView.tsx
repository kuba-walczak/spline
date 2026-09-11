import { useEffect, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { Icon } from '@/components/ui/icon'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { blocksToMarkdown } from '@shared/markdown'
import { parseAffiliations, serializeAffiliations } from '@shared/affiliations'

/* One person: a row in the People table and the page under it.

   Laid out the way a skill is, because a person is now the same shape — a name, a column beside it,
   and a body. The name and the affiliations are the row's columns; the description is the page, read
   as markdown and written back the same way.

   Affiliations are picked rather than typed: the list of them lives in Settings → People, and this
   view only adds from it. A person can hold several, so the one column is read and written as a
   comma-separated list — see shared/affiliations.

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

/** The add menu, after the composer's: same surface, same hairline, same lift. */
const menuStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  left: 0,
  zIndex: 41,
  minWidth: 200,
  maxHeight: 260,
  overflowY: 'auto',
  padding: 'var(--space-2)',
  background: '#20201F',
  border: '1px solid var(--border-default)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 24px rgba(0,0,0,0.35)'
}

/** One affiliation on a person. The same shell as a composer attachment chip — a project or a skill
    attached to a message — so the two read as the same kind of thing; the x takes it back off. */
function AffiliationChip({ label, onRemove }: { label: string; onRemove: () => void }): ReactElement {
  const [hovered, setHovered] = useState(false)

  return (
    <span
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flex: '0 0 auto',
        maxWidth: 220,
        height: 28,
        boxSizing: 'border-box',
        background: 'var(--surface-control)',
        border: '1px solid #4D4D4C',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden'
      }}
    >
      <span
        style={{
          minWidth: 0,
          padding: '0 4px 0 10px',
          color: '#E6E5E2',
          font: 'var(--type-meta)',
          letterSpacing: 'var(--tracking-tight)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        title={`Remove ${label}`}
        aria-label={`Remove ${label}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          flex: '0 0 auto',
          height: '100%',
          padding: '0 7px 0 3px',
          background: 'transparent',
          border: 'none',
          color: '#E6E5E2',
          cursor: 'pointer'
        }}
      >
        <Icon
          name="x"
          size={13}
          style={{ opacity: hovered ? 1 : 0.62, transition: 'var(--transition-control)' }}
        />
      </button>
    </span>
  )
}

/** A row in the add menu. */
function MenuItem({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        height: 30,
        padding: '0 8px',
        boxSizing: 'border-box',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        color: 'var(--text-primary)',
        font: 'var(--weight-regular) var(--text-base)/1 var(--font-sans)',
        letterSpacing: 'var(--tracking-tight)',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'var(--transition-control)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}
    >
      {label}
    </button>
  )
}

export interface PersonDetailViewProps {
  personId: string
  /** The list's copy, so the heading is populated before the fetch lands. */
  fallbackName: string
  /** Everything a person can be affiliated with — the list held in Settings → People. */
  affiliationOptions: string[]
  onBack: () => void
  /** Lets the sidebar list pick up a rename. */
  onSaved: () => void
}

export function PersonDetailView({
  personId,
  fallbackName,
  affiliationOptions,
  onBack,
  onSaved
}: PersonDetailViewProps): ReactElement {
  const [person, setPerson] = useState<PersonDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const [name, setName] = useState('')
  const [affiliations, setAffiliations] = useState<string[]>([])
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  /* Narrows a column's names to the ones the list still offers. Removing an affiliation in Settings
     removes it from every person as part of that save, so one still sitting in a column is already
     deleted and showing it would only offer to write it back. */
  const offered = new Set(affiliationOptions.map((option) => option.toLowerCase()))
  const offeredOnly = (names: string[]): string[] =>
    names.filter((name) => offered.has(name.toLowerCase()))

  /* The list can shrink while this person is open — the settings modal sits on top of this view.
     Whatever it removed is already off them in Notion, so it comes off the draft as well. The
     unchanged array is returned as itself when there is nothing to drop, so this settles in one
     pass. */
  useEffect(() => {
    setAffiliations((current) =>
      current.every((name) => offered.has(name.toLowerCase())) ? current : offeredOnly(current)
    )
  }, [affiliationOptions])

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
    setMenuOpen(false)

    window.api
      .getPerson(personId)
      .then((loaded) => {
        if (cancelled) return
        setPerson(loaded)
        setName(loaded.name)
        setAffiliations(offeredOnly(parseAffiliations(loaded.affiliation)))
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

  /* Compared as the one string the column holds, so a column written by hand in Notion — spaced
     differently, or with a blank between two commas — does not come back reading as an edit.

     Both sides are narrowed to what the list still offers, and an affiliation removed from the list
     is removed from everybody who had it, so a name the column holds that is not on the list has
     already been deleted: showing it would offer to write it back. One written into Notion by hand
     is hidden the same way, and dropped the next time this person is saved. */
  const affiliationDraft = serializeAffiliations(affiliations)
  const originalAffiliation = person
    ? serializeAffiliations(offeredOnly(parseAffiliations(person.affiliation)))
    : ''
  const dirty =
    ready &&
    (name !== person.name || affiliationDraft !== originalAffiliation || body !== originalBody)

  /* What is left to add. Matched case-insensitively, so an affiliation the column came back with in
     another casing is still recognised as one this person already has. */
  const chosen = new Set(affiliations.map((a) => a.toLowerCase()))
  const available = affiliationOptions.filter((option) => !chosen.has(option.toLowerCase()))

  async function save(): Promise<void> {
    if (saving || !dirty || !person) return
    setSaving(true)
    try {
      if (name !== person.name) await window.api.renamePerson(personId, name)
      if (affiliationDraft !== originalAffiliation) {
        await window.api.updatePersonAffiliation(personId, affiliationDraft)
      }
      if (body !== originalBody) await window.api.updatePersonContent(personId, body)

      /* Re-read rather than patching what we held: the body comes back as Notion actually laid it
         down, which is what the next dirty check has to compare against. */
      const reloaded = await window.api.getPerson(personId)
      setPerson(reloaded)
      setName(reloaded.name)
      setAffiliations(offeredOnly(parseAffiliations(reloaded.affiliation)))
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
    setAffiliations(offeredOnly(parseAffiliations(person.affiliation)))
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

          {/* One panelled card, hairline-divided, after the skill view's: name and affiliations share
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
                <h3 style={{ ...headingStyle, marginBottom: 'var(--space-3)' }}>Affiliations</h3>
                {loading ? (
                  <Skeleton height={FIELD_HEIGHT} radius="var(--radius-md)" delay={0.08} />
                ) : (
                  /* The chips and the plus share one wrapping row rather than sitting in a bordered
                     field: nothing here is typed into, and a text box would go on promising an edit
                     this half no longer takes. `minHeight` keeps the row level with the name field
                     beside it while it is still empty. */
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 'var(--space-3)',
                      minHeight: FIELD_HEIGHT
                    }}
                  >
                    {affiliations.map((affiliation) => (
                      <AffiliationChip
                        key={affiliation}
                        label={affiliation}
                        onRemove={() =>
                          setAffiliations((current) => current.filter((a) => a !== affiliation))
                        }
                      />
                    ))}

                    <div style={{ position: 'relative', flex: '0 0 auto' }}>
                      <IconButton
                        icon="plus"
                        label="Add affiliation"
                        size="sm"
                        glyphSize={16}
                        strokeWidth={2.5}
                        active={menuOpen}
                        disabled={failed}
                        onClick={() => setMenuOpen((v) => !v)}
                      />
                      {menuOpen ? (
                        <>
                          {/* Click-away catcher, as the composer's add menu has. */}
                          <div
                            onClick={() => setMenuOpen(false)}
                            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                          />
                          <div style={menuStyle}>
                            {available.length === 0 ? (
                              <div
                                style={{
                                  padding: '7px 8px',
                                  font: 'var(--weight-regular) var(--text-base)/1.3 var(--font-sans)',
                                  letterSpacing: 'var(--tracking-tight)',
                                  color: 'var(--text-faint)'
                                }}
                              >
                                {affiliationOptions.length > 0
                                  ? 'All affiliations added'
                                  : 'Add them in Settings → People'}
                              </div>
                            ) : (
                              available.map((option) => (
                                <MenuItem
                                  key={option}
                                  label={option}
                                  onClick={() => {
                                    setMenuOpen(false)
                                    setAffiliations((current) => [...current, option])
                                  }}
                                />
                              ))
                            )}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
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
