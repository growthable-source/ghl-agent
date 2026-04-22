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
    select: { id: true, expiresAt: true },
  })

  if (locations.length === 0) {
    return NextResponse.json({ status: 'not_connected', message: null })
  }

  const now = Date.now()
  const oneHourMs = 60 * 60 * 1000
  const staleLocations = locations.filter(l => l.expiresAt.getTime() < now)
  const nearExpiryLocations = locations.filter(l => {
    const t = l.expiresAt.getTime()
    return t >= now && t < now + oneHourMs
  })

  // Customer-friendly status, no internal detail exposed:
  //   - "healthy"     → nothing to show
  //   - "needs_attention" → stale tokens detected; suggest reconnect
  //   - "refreshing"  → tokens near-expiry, refresh cron should handle it
  if (staleLocations.length > 0) {
    return NextResponse.json({
      status: 'needs_attention',
      message: 'Your GoHighLevel connection may need a refresh. If agents stop replying, reconnect from Integrations.',
    })
  }
  if (nearExpiryLocations.length > 0) {
    return NextResponse.json({ status: 'refreshing', message: null })
  }
  return NextResponse.json({ status: 'healthy', message: null })
}
