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

  return (
    <div className="sticky bottom-0 left-0 right-0 z-30 mt-6">
      <div
        className={`mx-auto max-w-3xl rounded-xl border px-4 py-3 flex items-center gap-3 shadow-lg backdrop-blur transition-all ${
          error
            ? 'border-red-500/40 bg-red-500/10'
            : dirty
            ? 'border-amber-500/40 bg-amber-500/10'
            : 'border-emerald-500/30 bg-emerald-500/5'
        }`}
      >
        <div className="flex-1 flex items-center gap-2 text-xs">
          {error ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span className="text-red-300 font-medium">Couldn&apos;t save:</span>
              <span className="text-red-300/80">{error}</span>
            </>
          ) : saving ? (
            <>
              <span className="w-3 h-3 border-2 border-amber-400/50 border-t-amber-300 rounded-full animate-spin" />
              <span className="text-amber-300">Saving…</span>
            </>
          ) : dirty ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-300 font-medium">Unsaved changes</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 font-medium">Saved {ago}</span>
            </>
          )}
        </div>

        {dirty && !saving && onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-medium px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white transition-colors"
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
