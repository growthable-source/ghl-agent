'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

/**
 * Subtle CRM-connection health nudge.
 *
 * Renders NOTHING unless the `/api/workspaces/:ws/connection-health`
 * endpoint reports `needs_attention`. We deliberately hide the other
 * statuses (healthy / refreshing / not_connected) — ops detail belongs
 * in /admin, and we don't want to condition customers to dismiss a
 * banner that's rarely actionable.
 *
 * Poll cadence is every 5 minutes: the underlying refresh cron runs
 * every 30 minutes, so anything faster is wasted work.
 */
interface Props {
  workspaceId: string
}

type Status = 'healthy' | 'needs_attention' | 'refreshing' | 'not_connected'

export default function ConnectionHealthBanner({ workspaceId }: Props) {
  const [data, setData] = useState<{ status: Status; message: string | null } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/connection-health`, {
          cache: 'no-store',
        })
        if (!res.ok) return
        const json = (await res.json()) as { status: Status; message: string | null }
        if (!cancelled) setData(json)
      } catch {
        // swallow — the banner is opportunistic UX, not critical path
      }
    }
    load()
    const id = setInterval(load, 5 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [workspaceId])

  if (!data || data.status !== 'needs_attention' || dismissed) return null

  // Theme-token-driven colours — raw amber-950/300/200 weren't in
  // globals.css's light-mode override map, so the banner rendered as
  // pale-on-pale on the soft-light theme.
  return (
    <div
      className="px-4 py-2 flex items-center justify-between gap-3 border-b"
      style={{ background: 'var(--accent-amber-bg)', borderColor: 'var(--accent-amber)' }}
    >
      <p className="text-xs font-medium truncate" style={{ color: 'var(--accent-amber)' }}>
        {data.message ?? 'Your integration may need a refresh.'}
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/dashboard/${workspaceId}/integrations`}
          className="text-xs font-semibold px-3 py-1 rounded-md transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent-amber)', color: 'var(--btn-primary-text)' }}
        >
          Reconnect
        </Link>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          className="text-sm leading-none px-1 transition-opacity hover:opacity-100"
          style={{ color: 'var(--accent-amber)', opacity: 0.7 }}
        >
          ×
        </button>
      </div>
    </div>
  )
}
