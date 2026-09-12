import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Icon } from '@/components/ui/icon'
import { Switch } from '@/components/ui/switch'
import { IconButton } from '@/components/ui/icon-button'
import { formatPollSeconds } from '@/lib/pollInterval'
import { levelFraction, useVoiceLevel } from '@/lib/voiceMeter'
import { speakNow, speechVoices } from '@/lib/speech'
import {
  EMPTY_CONFIG,
  MAX_POLL_SECONDS,
  MIN_POLL_SECONDS,
  MAX_VOICE_SILENCE_DB,
  MIN_VOICE_SILENCE_DB,
  MAX_VOICE_SILENCE_MS,
  MIN_VOICE_SILENCE_MS,
  MAX_SPEECH_RATE,
  MIN_SPEECH_RATE,
  type AppConfig
} from '@shared/config'
import { isValidAffiliation, parseAffiliations, serializeAffiliations } from '@shared/affiliations'

/* Implementation of `Settings.dc.html` from the Claude app design system.

   Every setting here is a field of one JSON block on the Config page (see
   NotionService.fetch/saveConfig), and every one is edited the way Instructions/Context are
   elsewhere in the app: draft state, a dirty check against the loaded value, and an explicit sync
   through the refresh-cw button beside the section. That holds for the switch and the slider too —
   they read from the draft rather than applying as they are dragged, so the page has one rule about
   when a setting is actually stored. */

export interface SettingsModalProps {
  onClose: () => void
  /** Called after a sync, so the app picks up what was stored. `systemChanged` says whether the
      system instruction was part of it, since that is the one field open chats have to rebuild a
      prompt from. */
  onSaved: (systemChanged: boolean) => void
}

type SettingsTab = 'chats' | 'voice' | 'people'

const TABS: Array<{ id: SettingsTab; label: string; icon: string }> = [
  { id: 'chats', label: 'Chats', icon: 'message-circle' },
  { id: 'voice', label: 'Voice', icon: 'audio-lines' },
  { id: 'people', label: 'People', icon: 'users' }
]

/** The silence duration, as the readout beside its slider. */
function formatSilenceMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`
}

/* The scale the meter and the threshold marker are both drawn on. Wider than the window used for the
   composer button, because calibrating means seeing where a quiet room actually sits — which is
   nearer the bottom of this than the readable part of a level indicator needs to be. */
const METER_FLOOR = -80
const METER_CEILING = 0

/** What the room sounds like right now, against where the threshold has been put. The setting is a
    number with no meaning until it can be compared to something, and this is that something: speech
    should push the bar past the marker, and a quiet room should leave it short.

    A leaf, and deliberately so — levels arrive ten times a second, and the modal around it holds
    every setting in the app. It is also the only thing that asks for metering, so the listener stops
    reporting the moment this tab is left. */
function LevelMeter({ thresholdDb }: { thresholdDb: number }): ReactElement {
  const db = useVoiceLevel(true)
  const fraction = levelFraction(db, METER_FLOOR, METER_CEILING)
  const marker = levelFraction(thresholdDb, METER_FLOOR, METER_CEILING)
  const speaking = db > thresholdDb

  return (
    <div style={{ maxWidth: '710px', marginBottom: '28px' }}>
      <div
        style={{
          position: 'relative',
          height: '10px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-control)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: `${fraction * 100}%`,
            height: '100%',
            /* The bar says which side of the threshold the room is on, so that the answer does not
               depend on reading the marker's position against it. */
            background: speaking ? '#7FA87F' : '#4D4D4C',
            transition: 'width var(--duration-fast) var(--ease-standard), background var(--duration-fast) var(--ease-standard)'
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `${marker * 100}%`,
            width: '2px',
            background: '#E6E5E2'
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '8px',
          font: 'var(--type-meta)',
          letterSpacing: 'var(--tracking-tight)',
          color: 'var(--text-faint)'
        }}
      >
        <span>{speaking ? 'Hearing speech' : 'Quiet'}</span>
        <span style={{ font: 'var(--weight-medium) var(--text-xs)/1 var(--font-mono)' }}>
          {db <= METER_FLOOR ? '—' : `${db.toFixed(0)} dB`}
        </span>
      </div>
    </div>
  )
}

/** One affiliation in the list. The same shell a composer attachment chip and a person's affiliation
    wear, so the thing being edited here looks like the thing it becomes. */
function AffiliationChip({
  label,
  onRemove,
  disabled
}: {
  label: string
  onRemove: () => void
  disabled?: boolean
}): ReactElement {
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
        disabled={disabled}
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
          cursor: disabled ? 'not-allowed' : 'pointer'
        }}
      >
        <Icon
          name="x"
          size={13}
          style={{ opacity: hovered && !disabled ? 1 : 0.62, transition: 'var(--transition-control)' }}
        />
      </button>
    </span>
  )
}

/** A row in the settings nav. Hover brightens the icon and the label and nothing else — the filled
    row is what says which tab you are on, so painting it under the cursor as well made every tab
    look selected in passing. */
function SettingsTabButton({
  label,
  icon,
  selected,
  onClick
}: {
  label: string
  icon: string
  selected: boolean
  onClick: () => void
}): ReactElement {
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
        gap: '12px',
        width: '100%',
        height: '33px',
        padding: '0 11px',
        boxSizing: 'border-box',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
        borderRadius: 'var(--radius-sm)',
        backgroundColor: selected ? 'var(--surface-hover)' : 'transparent',
        /* The glyph draws in `currentColor`, so the one colour carries both halves of the row. */
        color: selected || hovered ? 'var(--text-primary)' : 'var(--text-muted)',
        transition: 'var(--transition-control)'
      }}
    >
      <Icon name={icon} size={16} />
      <span
        style={{
          font: `var(--weight-${selected ? 'semibold' : 'regular'}) var(--text-base)/1 var(--font-sans)`,
          letterSpacing: 'var(--tracking-tight)'
        }}
      >
        {label}
      </span>
    </button>
  )
}

export function SettingsModal({
  onClose,
  onSaved
}: SettingsModalProps): ReactElement {
  const [tab, setTab] = useState<SettingsTab>('chats')

  /* Every setting lives in one JSON block, so they load together and a save writes the lot — editing
     one must not drop another. Each still has its own dirty flag, so only the section being edited
     shows a sync button. */
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG)
  const [draft, setDraft] = useState<AppConfig>(EMPTY_CONFIG)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  /* What is being typed into the affiliation list, before the plus puts it in the draft. Not part of
     the config: an unadded name is not a setting yet. */
  const [newAffiliation, setNewAffiliation] = useState('')

  const systemDirty = draft.system !== config.system
  const titleDirty = draft.title !== config.title
  const affiliationsDirty =
    draft.affiliations.length !== config.affiliations.length ||
    draft.affiliations.some((name, i) => name !== config.affiliations[i])
  const expandToolsDirty = draft.expandTools !== config.expandTools
  const pollDirty = draft.pollSeconds !== config.pollSeconds
  /* One flag for the pair: they are two halves of the same rule about when a spoken message ends. */
  const voiceDirty =
    draft.voiceSilenceDb !== config.voiceSilenceDb || draft.voiceSilenceMs !== config.voiceSilenceMs
  /* Its own flag rather than folded into `voiceDirty`, matching the rule that each section shows
     its own sync button — and a field with no flag at all is a setting that can never be stored. */
  const speechDirty =
    draft.speechVoice !== config.speechVoice || draft.speechRate !== config.speechRate

  /* The machine's installed voices. Empty until the engine has enumerated them, which is why this
     is state and not a call at render time. */
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  useEffect(() => {
    let live = true
    void speechVoices().then((list) => {
      if (live) setVoices(list)
    })
    return () => {
      live = false
    }
  }, [])
  /* A voice chosen on another machine still has to show, or the select renders blank and the first
     change silently overwrites that machine's choice. */
  const voiceMissing = draft.speechVoice !== '' && !voices.some((v) => v.name === draft.speechVoice)

  /* Refused rather than silently deduped, so the reason a name did not appear is visible: a comma
     would be read back as two affiliations, and a repeat would give the People menu two identical
     rows. */
  const trimmedNew = newAffiliation.trim()
  const duplicate = draft.affiliations.some((name) => name.toLowerCase() === trimmedNew.toLowerCase())
  const canAdd = isValidAffiliation(newAffiliation) && !duplicate

  function addAffiliation(): void {
    if (!canAdd) return
    setDraft((d) => ({ ...d, affiliations: [...d.affiliations, trimmedNew] }))
    setNewAffiliation('')
  }
  const placeholder = loading ? 'Loading…' : failed ? 'Could not read the Config block.' : ''

  useEffect(() => {
    window.api
      .getConfig()
      .then((loaded) => {
        setConfig(loaded)
        setDraft(loaded)
      })
      .catch((err) => {
        console.error('[settings] getConfig failed:', err)
        setFailed(true)
      })
      .finally(() => setLoading(false))
  }, [])

  /* Writes the whole object either way — the block is one document, and a partial write would blank
     whichever field the other section is holding. */
  async function sync(): Promise<void> {
    if (saving || loading || failed) return
    setSaving(true)
    try {
      const systemChanged = draft.system !== config.system
      const removed = config.affiliations.filter(
        (name) => !draft.affiliations.some((kept) => kept.toLowerCase() === name.toLowerCase())
      )
      await window.api.saveConfig(draft)
      setConfig(draft)
      /* After the list is stored, so a failure here leaves people holding an affiliation that is no
         longer offered — recoverable by removing it again — rather than stripped of one the list
         still offers. */
      if (removed.length > 0) {
        /* Caught here rather than by the block below: the list itself is already stored, so a
           failure to prune must not look like a failed save or keep the app from picking it up. */
        try {
          await pruneAffiliations(removed)
        } catch (err) {
          console.error('[settings] pruning removed affiliations failed:', err)
        }
      }
      onSaved(systemChanged)
    } catch (err) {
      console.error('[settings] saveConfig failed:', err)
    } finally {
      setSaving(false)
    }
  }

  /* An affiliation taken off the list does not merely stop being offered — it is gone, so it comes
     off everybody who had it. Only the people who actually held one of the removed names are
     written, so removing an unused affiliation costs a single read. */
  async function pruneAffiliations(removed: string[]): Promise<void> {
    const gone = new Set(removed.map((name) => name.toLowerCase()))

    const people = await window.api.getPeople()
    for (const person of people) {
      const held = parseAffiliations(person.affiliation)
      const kept = held.filter((name) => !gone.has(name.toLowerCase()))
      if (kept.length === held.length) continue
      await window.api.updatePersonAffiliation(person.id, serializeAffiliations(kept))
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
            <SettingsTabButton
              key={entry.id}
              label={entry.label}
              icon={entry.icon}
              selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
            />
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
            {tab === 'chats' ? (
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
                    Tool details
                  </h2>
                  {expandToolsDirty ? (
                    <IconButton
                      icon="refresh-cw"
                      label="Sync to Notion"
                      size="sm"
                      onClick={() => void sync()}
                      disabled={saving}
                    />
                  ) : null}
                </div>
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
                    checked={draft.expandTools}
                    /* Held until the page has been read: a toggle made against the defaults would be
                       thrown away the moment the load landed on top of the draft. */
                    onChange={(value) => {
                      if (loading || failed) return
                      setDraft((d) => ({ ...d, expandTools: value }))
                    }}
                    label="Expand tool details by default"
                  />
                </div>

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
                    System
                  </h2>
                  {systemDirty ? (
                    <IconButton
                      icon="refresh-cw"
                      label="Sync to Notion"
                      size="sm"
                      onClick={() => void sync()}
                      disabled={saving}
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
                  Appended to every chat's system prompt, ahead of any project context. Stored as the `system` field of the Config page's JSON block.
                </p>
                <textarea
                  value={draft.system}
                  onChange={(e) => setDraft((d) => ({ ...d, system: e.target.value }))}
                  placeholder={placeholder}
                  disabled={loading || failed}
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
                    onClick={() => void sync()}
                    disabled={saving}
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
                The prompt sent when generating a chat's title. Stored as the `title` field of the Config page's JSON block.
              </p>
              <textarea
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder={placeholder}
                disabled={loading || failed}
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
                    Refresh rate
                  </h2>
                  {pollDirty ? (
                    <IconButton
                      icon="refresh-cw"
                      label="Sync to Notion"
                      size="sm"
                      onClick={() => void sync()}
                      disabled={saving}
                    />
                  ) : null}
                </div>
                <p
                  style={{
                    margin: '0 0 24px',
                    maxWidth: '710px',
                    font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-muted)'
                  }}
                >
                  How often the sidebar’s last-active labels are recalculated and project titles are
                  re-read from Notion.
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
                    value={draft.pollSeconds}
                    onChange={(e) => setDraft((d) => ({ ...d, pollSeconds: Number(e.target.value) }))}
                    disabled={loading || failed}
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
                    {formatPollSeconds(draft.pollSeconds)}
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
            ) : tab === 'voice' ? (
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
                    End of a spoken message
                  </h2>
                  {voiceDirty ? (
                    <IconButton
                      icon="refresh-cw"
                      label="Sync to Notion"
                      size="sm"
                      onClick={() => void sync()}
                      disabled={saving}
                    />
                  ) : null}
                </div>
                <p
                  style={{
                    margin: '0 0 24px',
                    maxWidth: '710px',
                    font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-muted)'
                  }}
                >
                  In voice mode, what is in the composer is sent once the microphone has been quieter
                  than the threshold for this long. Dictation uses neither — it only ever writes into
                  the composer, and waits to be sent.
                </p>

                <LevelMeter thresholdDb={draft.voiceSilenceDb} />

                <h3
                  style={{
                    margin: '0 0 4px',
                    font: 'var(--weight-medium) var(--text-base)/1.3 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-primary)'
                  }}
                >
                  Threshold
                </h3>
                <p
                  style={{
                    margin: '0 0 16px',
                    maxWidth: '710px',
                    font: 'var(--weight-regular) var(--text-sm)/1.45 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-muted)'
                  }}
                >
                  Set this just above where the meter sits in a quiet room. Speech usually runs
                  between −35 and −15 dB.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '18px', maxWidth: '710px' }}>
                  <input
                    type="range"
                    min={MIN_VOICE_SILENCE_DB}
                    max={MAX_VOICE_SILENCE_DB}
                    step={1}
                    value={draft.voiceSilenceDb}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, voiceSilenceDb: Number(e.target.value) }))
                    }
                    disabled={loading || failed}
                    aria-label="Silence threshold in decibels"
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
                    {draft.voiceSilenceDb} dB
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
                  <span>Hears almost anything</span>
                  <span>Hears only a raised voice</span>
                </div>

                <h3
                  style={{
                    margin: '32px 0 4px',
                    font: 'var(--weight-medium) var(--text-base)/1.3 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-primary)'
                  }}
                >
                  Pause before sending
                </h3>
                <p
                  style={{
                    margin: '0 0 16px',
                    maxWidth: '710px',
                    font: 'var(--weight-regular) var(--text-sm)/1.45 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-muted)'
                  }}
                >
                  Long enough to think mid-sentence without the message going early; short enough
                  that finishing one does not mean waiting on it.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '18px', maxWidth: '710px' }}>
                  <input
                    type="range"
                    min={MIN_VOICE_SILENCE_MS}
                    max={MAX_VOICE_SILENCE_MS}
                    step={100}
                    value={draft.voiceSilenceMs}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, voiceSilenceMs: Number(e.target.value) }))
                    }
                    disabled={loading || failed}
                    aria-label="Pause before sending, in milliseconds"
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
                    {formatSilenceMs(draft.voiceSilenceMs)}
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
                  <span>{formatSilenceMs(MIN_VOICE_SILENCE_MS)}</span>
                  <span>{formatSilenceMs(MAX_VOICE_SILENCE_MS)}</span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                    margin: '40px 0 8px',
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
                    Spoken replies
                  </h2>
                  {speechDirty ? (
                    <IconButton
                      icon="refresh-cw"
                      label="Sync to Notion"
                      size="sm"
                      onClick={() => void sync()}
                      disabled={saving}
                    />
                  ) : null}
                </div>
                <p
                  style={{
                    margin: '0 0 24px',
                    maxWidth: '710px',
                    font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-muted)'
                  }}
                >
                  Replies are read aloud while voice mode is on, and only then — talking over one
                  stops it. Code blocks and tables are skipped rather than spelled out.
                </p>

                <h3
                  style={{
                    margin: '0 0 4px',
                    font: 'var(--weight-medium) var(--text-base)/1.3 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-primary)'
                  }}
                >
                  Voice
                </h3>
                <p
                  style={{
                    margin: '0 0 16px',
                    maxWidth: '710px',
                    font: 'var(--weight-regular) var(--text-sm)/1.45 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-muted)'
                  }}
                >
                  The voices Windows has installed. Left automatic, an English one is preferred over
                  the system default, which on this machine reads English in a Polish accent.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '18px', maxWidth: '710px' }}>
                  <select
                    value={draft.speechVoice}
                    onChange={(e) => setDraft((d) => ({ ...d, speechVoice: e.target.value }))}
                    disabled={loading || failed || voices.length === 0}
                    aria-label="Voice for spoken replies"
                    style={{
                      flex: '1 1 auto',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      padding: '8px 10px',
                      background: 'var(--surface-control)',
                      color: 'var(--text-body)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      font: 'var(--weight-regular) var(--text-base)/1.2 var(--font-sans)',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="">
                      {voices.length === 0
                        ? 'No speech voices reported'
                        : 'Automatic — prefers an English voice'}
                    </option>
                    {voiceMissing ? (
                      <option value={draft.speechVoice}>
                        {draft.speechVoice} — not installed on this machine
                      </option>
                    ) : null}
                    {voices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name} — {voice.lang}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      speakNow('Reading replies aloud at this rate.', {
                        voiceName: draft.speechVoice,
                        rate: draft.speechRate
                      })
                    }
                    disabled={loading || failed}
                    style={{
                      flex: '0 0 auto',
                      padding: '8px 14px',
                      background: 'var(--surface-control)',
                      color: 'var(--text-body)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      font: 'var(--weight-medium) var(--text-base)/1.2 var(--font-sans)',
                      cursor: 'pointer'
                    }}
                  >
                    Test
                  </button>
                </div>

                <h3
                  style={{
                    margin: '32px 0 4px',
                    font: 'var(--weight-medium) var(--text-base)/1.3 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-primary)'
                  }}
                >
                  Reading speed
                </h3>

                <div style={{ display: 'flex', alignItems: 'center', gap: '18px', maxWidth: '710px' }}>
                  <input
                    type="range"
                    min={MIN_SPEECH_RATE}
                    max={MAX_SPEECH_RATE}
                    step={0.05}
                    value={draft.speechRate}
                    onChange={(e) => setDraft((d) => ({ ...d, speechRate: Number(e.target.value) }))}
                    disabled={loading || failed}
                    aria-label="Reading speed"
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
                    {draft.speechRate.toFixed(2)}&times;
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
                  <span>Half speed</span>
                  <span>Double speed</span>
                </div>

                <p
                  style={{
                    margin: '32px 0 0',
                    maxWidth: '710px',
                    font: 'var(--weight-regular) var(--text-sm)/1.45 var(--font-sans)',
                    letterSpacing: 'var(--tracking-tight)',
                    color: 'var(--text-faint)'
                  }}
                >
                  Voice mode is switched on and off by saying “hey livekit”, or by the button in the
                  composer. It stays on after a message is sent, so the next thing said goes into the
                  composer in turn.
                </p>
              </>
            ) : (
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
                    Affiliations
                  </h2>
                  {affiliationsDirty ? (
                    <IconButton
                      icon="refresh-cw"
                      label="Sync to Notion"
                      size="sm"
                      onClick={() => void sync()}
                      disabled={saving}
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
                  What a person can be affiliated with. A person picks from this list rather than typing
                  their own, and can hold more than one. Removing one here takes it off everybody who has
                  it. Stored as the `affiliations` field of the Config page&rsquo;s JSON block.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', maxWidth: '710px' }}>
                  <input
                    value={newAffiliation}
                    onChange={(e) => setNewAffiliation(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      addAffiliation()
                    }}
                    placeholder={placeholder || 'Add an affiliation'}
                    disabled={loading || failed}
                    style={{
                      flex: '1 1 auto',
                      minWidth: 0,
                      height: '40px',
                      boxSizing: 'border-box',
                      padding: '0 14px',
                      background: 'var(--surface-inset)',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--text-body)',
                      font: 'var(--weight-regular) var(--text-base)/1 var(--font-sans)',
                      letterSpacing: 'var(--tracking-tight)',
                      outline: 'none',
                      boxShadow: 'none'
                    }}
                  />
                  <IconButton
                    icon="plus"
                    label="Add affiliation"
                    variant="filled"
                    glyphSize={18}
                    strokeWidth={2.5}
                    disabled={loading || failed || !canAdd}
                    onClick={addAffiliation}
                  />
                </div>

                {/* Only said when there is something to say — a hint under an empty box would read as
                    an error before anything had been typed. */}
                {trimmedNew && !canAdd ? (
                  <p
                    style={{
                      margin: '8px 0 0',
                      maxWidth: '710px',
                      font: 'var(--type-meta)',
                      letterSpacing: 'var(--tracking-tight)',
                      color: 'var(--text-faint)'
                    }}
                  >
                    {duplicate ? 'Already on the list.' : 'An affiliation cannot contain a comma.'}
                  </p>
                ) : null}

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px',
                    maxWidth: '710px',
                    marginTop: '20px'
                  }}
                >
                  {draft.affiliations.length === 0 ? (
                    <span
                      style={{
                        font: 'var(--weight-regular) var(--text-base)/1.45 var(--font-sans)',
                        letterSpacing: 'var(--tracking-tight)',
                        color: 'var(--text-faint)'
                      }}
                    >
                      {loading ? 'Loading…' : failed ? 'Could not read the Config block.' : 'No affiliations yet.'}
                    </span>
                  ) : (
                    draft.affiliations.map((name) => (
                      <AffiliationChip
                        key={name}
                        label={name}
                        disabled={saving}
                        onRemove={() =>
                          setDraft((d) => ({
                            ...d,
                            affiliations: d.affiliations.filter((entry) => entry !== name)
                          }))
                        }
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
