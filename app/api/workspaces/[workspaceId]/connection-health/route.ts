import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * Customer-facing connection health check.
 *
 * Deliberately minimal: returns only enough information for the UI to
 * show a subtle "reconnect" nudge when the user's GHL connection is at
 * risk of failing. No per-location metadata, no token details, no
 * refresh attempt logs — those live in /admin.
 *
 * Used by:
 *   - a small banner at the top of the dashboard
 *   - the Integrations page
 * to prompt reconnection BEFORE the agent actually fails on an inbound.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({
    where: { workspaceId, crmProvider: { not: 'none' } },
    select: { id: true, expiresAt: true, tokenRefreshFailedAt: true },
  })

  if (locations.length === 0) {
    return NextResponse.json({ status: 'not_connected', message: null })
  }

  const now = Date.now()
  const NINETY_MIN_MS = 90 * 60 * 1000

  // The banner should fire ONLY for genuinely-dead connections — a
  // refresh that returned invalid_grant, which the cron records in
  // tokenRefreshFailedAt. A token that's merely expired (or near
  // expiry) self-heals on the next 30-minute refresh tick and must
  // NOT alarm the user; alarming on every expiry produced stale
  // "needs refresh" banners that never cleared and trained users to
  // ignore the warning.
  const deadLocations = locations.filter(l => l.tokenRefreshFailedAt != null)
  if (deadLocations.length > 0) {
    return NextResponse.json({
      status: 'needs_attention',
      message: 'Your LeadConnector connection has expired and needs reconnecting. Reconnect from Integrations to get your agents replying again.',
    })
  }

  // Belt-and-braces: a token expired for well over a full refresh
  // cycle (90 min) with NO failure flag means the cron isn't running
  // or hasn't reached it — still worth a soft nudge.
  const longStale = locations.filter(l => l.expiresAt.getTime() < now - NINETY_MIN_MS)
  if (longStale.length > 0) {
    return NextResponse.json({
      status: 'needs_attention',
      message: 'Your LeadConnector connection may need a refresh. If agents stop replying, reconnect from Integrations.',
    })
  }

  return NextResponse.json({ status: 'healthy', message: null })
}
