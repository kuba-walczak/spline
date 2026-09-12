import { useEffect, useState } from 'react'

/* The meter on the Voice tab in Settings is the only thing watching the level today, but a count
   rather than a flag: mounts overlap even with one caller, since React mounts, unmounts and remounts
   an effect in development, and a flag would switch the listener off on the way through. The
   listener needs telling only whether anyone at all is watching, and the last one to look away is
   the one that switches it off. */
let watchers = 0

function setWatching(next: number): void {
    const was = watchers > 0
    watchers = next
    if (was !== watchers > 0) window.api.setVoiceMeter(watchers > 0)
}

/** The most recent input level in dBFS while `enabled`, or silence when nothing is listening.

    Levels arrive about ten times a second, so whatever calls this re-renders at that rate: it
    belongs in a leaf that draws the level and nothing else. Called from a component that also
    renders a chat or a settings page, it would redraw the lot ten times a second. */
export function useVoiceLevel(enabled: boolean): number {
    const [db, setDb] = useState(-100)

    useEffect(() => {
        if (!enabled) {
            /* Reset rather than hold: the last level heard before switching off is not the level
               now, and a meter left standing at it looks like a mic that is still open. */
            setDb(-100)
            return
        }

        setWatching(watchers + 1)
        const unsubscribe = window.api.onVoiceEvent((event) => {
            if (event.kind === 'level') setDb(event.db)
        })

        return () => {
            unsubscribe()
            setWatching(watchers - 1)
        }
    }, [enabled])

    return db
}

/** Where a level sits between two dBFS bounds, 0 to 1. The bounds belong to whatever is drawing the
    scale, so they are passed rather than assumed. */
export function levelFraction(db: number, floor: number, ceiling: number): number {
    if (!Number.isFinite(db)) return 0
    return Math.min(1, Math.max(0, (db - floor) / (ceiling - floor)))
}
