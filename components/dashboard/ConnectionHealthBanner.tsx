'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useBannerDismissal } from '@/lib/use-banner-dismissal'
import BannerDismissMenu from './BannerDismissMenu'

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
  // Persistent dismissal — survives refresh. Operators can snooze the
  // nudge for 1d / 1w or kill it forever. If the underlying status
  // ever flips back to healthy and then re-degrades, the banner will
  // reappear regardless of dismissal because we re-check on each load.
  const { hidden, snooze, dismissForever } = useBannerDismissal('connection-health')

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

  if (!data || data.status !== 'needs_attention' || hidden) return null

  // Amber banner (handoff AlertBanner): icon + message + Reconnect + Dismiss.
  return (
    <div className="px-6 pt-4">
      <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-[13px] text-amber-700 min-w-0">
          <span aria-hidden className="mr-2">⚠</span>
          <strong className="font-semibold">LeadConnector connection needs attention.</strong>{' '}
          {data.message ?? 'Your integration may need a refresh.'}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/dashboard/${workspaceId}/integrations`}
            className="h-8 inline-flex items-center rounded-md px-3 text-[12.5px] font-semibold bg-amber-500 text-on-brand hover:bg-amber-600"
          >
            Reconnect
          </Link>
          <BannerDismissMenu
            accentColor="var(--accent-amber)"
            onSnooze={snooze}
            onDismissForever={dismissForever}
          />
        </div>
      </div>
    </div>
  )
}
