'use client'

import { useEffect, useRef } from 'react'

/**
 * Dismissible promo strip at the very top of the marketing homepage.
 * Persistence is plain localStorage (public page — the dashboard's
 * workspace-scoped useBannerDismissal doesn't apply).
 *
 * Rendered by default (so it's present for SSR / no-JS), then hidden via
 * the DOM ref if the visitor previously dismissed it — no setState in an
 * effect, and no hydration mismatch.
 */
export default function AnnouncementBar() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      if (localStorage.getItem('vox:promo:copilot') === 'dismissed') {
        ref.current?.style.setProperty('display', 'none')
      }
    } catch {
      /* ignore */
    }
  }, [])

  function dismiss() {
    try {
      localStorage.setItem('vox:promo:copilot', 'dismissed')
    } catch {
      /* ignore */
    }
    ref.current?.style.setProperty('display', 'none')
  }

  return (
    <div ref={ref} className="relative z-50 text-sm" style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}>
      <div className="max-w-[1280px] mx-auto px-10 py-2 flex items-center justify-center gap-2 flex-wrap text-center">
        <span>
          ✨ <strong>New</strong> — Co-Pilot now joins your live calls.
        </span>
        <a href="#copilot" className="font-semibold underline underline-offset-2 hover:opacity-90">
          Try the demo →
        </a>
        <button
          type="button"
          aria-label="Dismiss announcement"
          onClick={dismiss}
          className="absolute right-3 top-1/2 -translate-y-1/2 opacity-80 hover:opacity-100 leading-none"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
