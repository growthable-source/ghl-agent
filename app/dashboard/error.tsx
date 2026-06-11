'use client'

/**
 * Dashboard error boundary.
 *
 * Before this existed, any client-side throw in a dashboard page
 * (a null-deref in a render path, a bad map over an unexpected API
 * shape) blanked the whole tab — the user saw a white screen with no
 * way out but a manual reload, and we got no signal. Now they get a
 * recoverable card and the error is reported.
 *
 * Scoped to /dashboard so the marketing/auth shells keep their own
 * (simpler) failure behavior; global-error.tsx catches anything that
 * escapes even the root layout.
 */

import { useEffect } from 'react'

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[dashboard error boundary]', error)
  }, [error])

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-xl border p-6 text-center"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div
          className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center"
          style={{ background: 'var(--accent-red-bg)' }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent-red)" strokeWidth="1.8" className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Something went wrong on this page
        </h2>
        <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
          The rest of your dashboard is fine. You can retry this page, or head back to your overview.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition hover:opacity-90"
            style={{ background: 'var(--accent-primary)' }}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              window.location.href = '/dashboard'
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium transition"
            style={{ border: '1px solid var(--border-secondary)', color: 'var(--text-secondary)' }}
          >
            Back to overview
          </button>
        </div>
        {error.digest && (
          <p className="mt-4 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            ref: {error.digest}
          </p>
        )}
      </div>
    </div>
  )
}
