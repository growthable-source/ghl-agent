'use client'

import { useEffect, useRef } from 'react'

// Shared with CannyIdentify — same app, same SDK. Kept as a constant
// rather than an env var because Canny publishes appID in their own
// widget markup anyway; it's not a secret.
const CANNY_APP_ID = '69d62477414c6291da2963c2'

/**
 * Sidebar-footer-sized button that opens the Canny changelog popup.
 *
 * The Canny SDK itself is loaded globally from app/layout.tsx; this
 * component just calls `Canny('initChangelog', ...)` once and relies
 * on Canny's click handler binding to our element via the
 * `data-canny-changelog` attribute. When a user clicks the button,
 * Canny takes over and shows its own popover.
 *
 * A small unread-count badge is rendered by Canny into the child
 * `.Canny_BadgeContainer` — we leave the slot empty and let the SDK
 * paint into it. If the SDK hasn't loaded (network blip, blocker
 * extension), the button still shows and clicks are no-ops; that's
 * the graceful-degradation path.
 */
export default function CannyChangelogButton({ className = '' }: { className?: string }) {
  const initialized = useRef(false)

  useEffect(() => {
    if (initialized.current) return
    // Poll briefly for the SDK to be ready — it's loaded async in the
    // root layout, so on fast clients it's there immediately but a
    // slow network might need a couple of ticks.
    let attempts = 0
    const interval = setInterval(() => {
      attempts++
      if (typeof window.Canny === 'function') {
        window.Canny('initChangelog', {
          appID: CANNY_APP_ID,
          position: 'top',
          align: 'right',
          theme: 'dark',
        })
        initialized.current = true
        clearInterval(interval)
      } else if (attempts > 40) {   // give up after ~4s
        clearInterval(interval)
      }
    }, 100)
    return () => clearInterval(interval)
  }, [])

  return (
    <button
      type="button"
      data-canny-changelog
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors w-full ${className}`}
      aria-label="What's new"
    >
      <span>What&apos;s new</span>
      {/* Canny paints its own unread badge into this node. We style
          the container so the painted number looks native in the
          sidebar. Canny's own class names handle the rest. */}
      <span className="ml-auto Canny_BadgeContainer" />
    </button>
  )
}
