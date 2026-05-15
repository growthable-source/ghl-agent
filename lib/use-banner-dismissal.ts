'use client'

/**
 * Persistent banner-dismissal hook.
 *
 * Most of our top-bar banners (ConnectionHealth, Trial, future onboarding
 * prompts) used to be either always-on or had per-tab dismiss state that
 * died on refresh. Operators complained: "I dismiss it, refresh, it's
 * back."
 *
 * This hook backs the dismissal in localStorage with three states:
 *   - visible   — nothing stored, or snooze expired
 *   - snoozed   — hidden until snoozedUntil
 *   - forever   — hidden permanently for this browser
 *
 * It deliberately keys per banner-ID (not per-workspace) so the same
 * operator using the same browser doesn't keep re-dismissing the same
 * trial banner as they switch between workspaces. If we ever need
 * per-workspace dismissal, the key just becomes `${id}:${workspaceId}`.
 *
 * Server-driven banners that signal real ops state (e.g. agent paused,
 * trial expired) should NOT use this — those need to clear themselves
 * when the underlying state changes, not when the user clicks ×.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'voxility:banner-dismissals'

type Status = 'visible' | 'snoozed' | 'forever'

interface DismissalEntry {
  status: 'snoozed' | 'forever'
  snoozedUntil: number | null
}

function readStore(): Record<string, DismissalEntry> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: Record<string, DismissalEntry>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* private mode / quota — banner just stays visible */
  }
}

export function useBannerDismissal(bannerId: string) {
  // Start hidden if SSR — we can't read localStorage server-side, so
  // we flicker-in if the user has dismissed. The alternative
  // (start visible, flicker out) is more annoying because the banner
  // looks like it bounced. Most banners are below the fold of the
  // initial paint anyway.
  const [status, setStatus] = useState<Status>('visible')

  useEffect(() => {
    const store = readStore()
    const entry = store[bannerId]
    if (!entry) {
      setStatus('visible')
      return
    }
    if (entry.status === 'forever') {
      setStatus('forever')
      return
    }
    if (entry.status === 'snoozed' && entry.snoozedUntil && entry.snoozedUntil > Date.now()) {
      setStatus('snoozed')
      // Wake up + re-render when the snooze expires.
      const remaining = entry.snoozedUntil - Date.now()
      const timer = setTimeout(() => {
        const s = readStore()
        delete s[bannerId]
        writeStore(s)
        setStatus('visible')
      }, remaining)
      return () => clearTimeout(timer)
    }
    // Snooze expired — clean up + show.
    delete store[bannerId]
    writeStore(store)
    setStatus('visible')
  }, [bannerId])

  const snooze = useCallback((hours: number) => {
    const store = readStore()
    store[bannerId] = { status: 'snoozed', snoozedUntil: Date.now() + hours * 60 * 60 * 1000 }
    writeStore(store)
    setStatus('snoozed')
  }, [bannerId])

  const dismissForever = useCallback(() => {
    const store = readStore()
    store[bannerId] = { status: 'forever', snoozedUntil: null }
    writeStore(store)
    setStatus('forever')
  }, [bannerId])

  const reset = useCallback(() => {
    const store = readStore()
    delete store[bannerId]
    writeStore(store)
    setStatus('visible')
  }, [bannerId])

  return {
    hidden: status !== 'visible',
    status,
    snooze,
    dismissForever,
    reset,
  }
}
