'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { useBackgroundPolling } from '@/lib/use-background-polling'

/**
 * Cross-sidebar nav-badge counts — polls the workspace's attention-
 * worthy endpoints once per 30s and exposes the counts to any
 * consumer via useNavCounts(). Centralised so we don't fan out N
 * polls for N sidebar badges, and so nested components stay cheap.
 *
 * Adding a new badge: extend the NavCounts shape + fetch it inside
 * refresh(). A return of 0 or null means "don't render a badge."
 */

interface NavCounts {
  needsAttention: number | null
  approvalsPending: number | null
  inboxUnread: number | null
}

const EMPTY: NavCounts = { needsAttention: null, approvalsPending: null, inboxUnread: null }

const Ctx = createContext<NavCounts>(EMPTY)

const POLL_INTERVAL_MS = 30_000

export function NavCountsProvider({ workspaceId, children }: { workspaceId: string | null; children: React.ReactNode }) {
  const [counts, setCounts] = useState<NavCounts>(EMPTY)

  const refresh = useCallback(async () => {
    if (!workspaceId || workspaceId === 'undefined') {
      setCounts(EMPTY)
      return
    }
    // Parallel fetches — neither blocks the other, a failure on one
    // endpoint leaves the other's badge intact rather than wiping both.
    const [needs, approvals, inbox] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/needs-attention`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => (d?.items?.length ?? null) as number | null)
        .catch(() => null),
      fetch(`/api/workspaces/${workspaceId}/approvals?status=pending&count=1`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => (typeof d?.count === 'number' ? d.count : (d?.items?.length ?? null)) as number | null)
        .catch(() => null),
      fetch(`/api/workspaces/${workspaceId}/inbox/unread-count`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => (typeof d?.count === 'number' ? d.count : null) as number | null)
        .catch(() => null),
    ])
    setCounts({ needsAttention: needs, approvalsPending: approvals, inboxUnread: inbox })
  }, [workspaceId])

  // Visibility-aware: stops polling in backgrounded tabs (this runs on
  // EVERY dashboard page, so a forever-interval was the single biggest
  // source of idle API load + battery drain), refreshes on return.
  useBackgroundPolling(refresh, POLL_INTERVAL_MS, !!workspaceId && workspaceId !== 'undefined')

  return <Ctx.Provider value={counts}>{children}</Ctx.Provider>
}

export function useNavCounts(): NavCounts {
  return useContext(Ctx)
}

/**
 * iOS-style red circular badge. Hidden when count is null, 0, or
 * negative. 99+ cap so wide numbers don't blow the nav width.
 */
export function NavBadge({ count }: { count: number | null | undefined }) {
  if (count === null || count === undefined || count <= 0) return null
  const label = count > 99 ? '99+' : String(count)
  return (
    <span
      className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center leading-none"
      aria-label={`${count} item${count === 1 ? '' : 's'} needing attention`}
    >
      {label}
    </span>
  )
}
