'use client'

import { useEffect, useRef } from 'react'

/**
 * Interval polling that pauses when the tab is hidden.
 *
 * The dashboard had ~7 independent setInterval pollers (sidebar
 * counts every 30s, inbox every 8s, activity every 5s, …) that ran
 * forever — including in backgrounded tabs. On a laptop with a few
 * dashboard tabs open, that's continuous battery drain and a steady
 * stream of pointless requests hammering the API. This hook ties the
 * interval to the Page Visibility API: it polls while the tab is
 * visible, stops when hidden, and fires once immediately on becoming
 * visible again so the user sees fresh data the moment they look.
 *
 * Usage: useBackgroundPolling(refresh, 30000) — `fn` may be async;
 * overlapping ticks are prevented (a slow request won't stack).
 */
export function useBackgroundPolling(fn: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return
    if (typeof document === 'undefined') return

    let timer: ReturnType<typeof setInterval> | null = null
    let running = false

    const tick = async () => {
      if (running || document.hidden) return
      running = true
      try {
        await fnRef.current()
      } finally {
        running = false
      }
    }

    const start = () => {
      if (timer) return
      timer = setInterval(tick, intervalMs)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }

    const onVisibility = () => {
      if (document.hidden) {
        stop()
      } else {
        void tick() // refresh immediately on return
        start()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    if (!document.hidden) start()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [intervalMs, enabled])
}
