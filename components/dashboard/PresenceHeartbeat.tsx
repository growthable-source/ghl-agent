'use client'

import { useEffect, useRef } from 'react'

/**
 * Dashboard activity heartbeat — feeds auto-away.
 *
 * Mounted once in the workspace layout so ANY dashboard page counts as
 * activity (an operator configuring an agent is still at their desk and
 * available for chats). "Activity" means real input — pointer, keys,
 * scroll — not merely an open tab: a browser left running overnight
 * produces no input, sends no beats, and the member drifts to Away on
 * schedule, which is the whole point.
 *
 * Throttling: input just marks a dirty flag; at most one POST per
 * minute goes out, and only when the flag is set and the tab is
 * visible. Returning to the tab beats immediately so a system-flipped
 * member is restored to Available within a second of coming back.
 */

const BEAT_INTERVAL_MS = 60_000

export default function PresenceHeartbeat({ workspaceId }: { workspaceId: string }) {
  // Mount counts as activity — you just navigated here.
  const dirty = useRef(true)

  useEffect(() => {
    let stopped = false
    const markDirty = () => { dirty.current = true }

    const beat = async () => {
      if (stopped || !dirty.current || document.visibilityState === 'hidden') return
      dirty.current = false
      try {
        await fetch(`/api/workspaces/${workspaceId}/me/heartbeat`, { method: 'POST' })
      } catch {
        // Network blip — keep the activity pending for the next tick.
        dirty.current = true
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        dirty.current = true
        beat()
      }
    }

    window.addEventListener('pointerdown', markDirty, { passive: true })
    window.addEventListener('keydown', markDirty, { passive: true })
    window.addEventListener('wheel', markDirty, { passive: true })
    window.addEventListener('mousemove', markDirty, { passive: true })
    document.addEventListener('visibilitychange', onVisibility)

    beat()
    const interval = setInterval(beat, BEAT_INTERVAL_MS)

    return () => {
      stopped = true
      clearInterval(interval)
      window.removeEventListener('pointerdown', markDirty)
      window.removeEventListener('keydown', markDirty)
      window.removeEventListener('wheel', markDirty)
      window.removeEventListener('mousemove', markDirty)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [workspaceId])

  return null
}
