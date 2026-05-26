'use client'

import { useEffect, useState } from 'react'

/**
 * SaveBar — sticky footer bar that appears when a form is dirty.
 * One pattern across every agent sub-page. Shows:
 *   - "Unsaved changes" indicator when dirty
 *   - "Saved just now / 5s ago" when clean after a recent save
 *   - Save button (primary) + Discard button (secondary)
 *   - Saving spinner
 *   - Error state with message
 */
export default function SaveBar({
  dirty,
  saving,
  savedAt,
  error,
  onSave,
  onReset,
  saveLabel = 'Save changes',
  discardLabel = 'Discard',
}: {
  dirty: boolean
  saving: boolean
  savedAt: Date | null
  error: string | null
  onSave: () => void
  onReset?: () => void
  saveLabel?: string
  discardLabel?: string
}) {
  const [ago, setAgo] = useState<string>('')

  useEffect(() => {
    if (!savedAt) return
    function tick() {
      const s = Math.floor((Date.now() - savedAt!.getTime()) / 1000)
      if (s < 3) setAgo('just now')
      else if (s < 60) setAgo(`${s}s ago`)
      else if (s < 3600) setAgo(`${Math.floor(s / 60)}m ago`)
      else setAgo('') // stop showing after an hour
    }
    tick()
    const id = setInterval(tick, 3000)
    return () => clearInterval(id)
  }, [savedAt])

  // Render nothing when there's absolutely nothing to say
  if (!dirty && !saving && !error && !ago) return null

  // Pick design-token colours per state so the bar reads cleanly in
  // both themes. The previous hardcoded `bg-amber-500/10 text-amber-300`
  // worked in dark mode but rendered yellow-on-white in light theme —
  // the "Unsaved changes" bar Ryan flagged as unreadable.
  const accent =
    error
      ? { bg: 'var(--accent-red-bg)',     border: 'var(--accent-red)',     fg: 'var(--accent-red)' }
      : dirty
      ? { bg: 'var(--accent-amber-bg)',   border: 'var(--accent-amber)',   fg: 'var(--accent-amber)' }
      : { bg: 'var(--accent-emerald-bg)', border: 'var(--accent-emerald)', fg: 'var(--accent-emerald)' }

  return (
    <div className="sticky bottom-0 left-0 right-0 z-30 mt-6">
      <div
        className="mx-auto max-w-3xl rounded-xl border px-4 py-3 flex items-center gap-3 shadow-lg backdrop-blur transition-all"
        style={{ background: accent.bg, borderColor: accent.border }}
      >
        <div className="flex-1 flex items-center gap-2 text-xs">
          {error ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent.fg }} />
              <span className="font-medium" style={{ color: accent.fg }}>Couldn&apos;t save:</span>
              <span style={{ color: accent.fg, opacity: 0.85 }}>{error}</span>
            </>
          ) : saving ? (
            <>
              <span
                className="w-3 h-3 border-2 rounded-full animate-spin"
                style={{ borderColor: accent.fg, opacity: 0.5, borderTopColor: accent.fg, borderTopOpacity: 1 } as any}
              />
              <span style={{ color: accent.fg }}>Saving…</span>
            </>
          ) : dirty ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: accent.fg }} />
              <span className="font-medium" style={{ color: accent.fg }}>Unsaved changes</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent.fg }} />
              <span className="font-medium" style={{ color: accent.fg }}>Saved {ago}</span>
            </>
          )}
        </div>

        {dirty && !saving && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:opacity-100"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {discardLabel}
          </button>
        )}
        {(dirty || error) && (
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="text-xs font-semibold px-4 py-1.5 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: '#fa4d2e' }}
          >
            {saving ? 'Saving…' : error ? 'Retry' : saveLabel}
          </button>
        )}
      </div>
    </div>
  )
}
