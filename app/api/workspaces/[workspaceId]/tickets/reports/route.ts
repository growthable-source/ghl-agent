import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getTicketingStatus } from '@/lib/ticketing-access'
import { getTicketMetrics } from '@/lib/support-metrics/tickets'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:ws/tickets/reports
 *
 * Query params (all optional, all combine):
 *   days     1..365 (default 30) — trailing-days bucket
 *   from/to  YYYY-MM-DD — explicit range, overrides days
 *   brandId  scope to one brand; 'no_brand' = unbranded only
 *   handler  'ai' | 'human' — not used here, reserved for parity
 *            with CSAT
 *
 * Returns the data shapes the reports page renders:
 *   scorecards         { open, created, closed, avgResolutionHours }
 *   trend              previous-window deltas for each scorecard
 *   byStatus           [{ status, count }]
 *   byPriority         [{ priority, count }]
 *   byBrand            [{ brandId, name, color, count, openCount,
 *                         avgResolutionHours }]
 *   byOperator         [{ userId, name, email, image, count,
 *                         openCount, avgResolutionHours }]
 *   created            [{ day: 'YYYY-MM-DD', count }] daily series
 *   closed             [{ day: 'YYYY-MM-DD', count }] daily series
 *   allBrands          brand picker source-of-truth
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const status = await getTicketingStatus(workspaceId)
  if (!status.active) {
    return NextResponse.json({ inactive: true, reason: status.reason })
  }

  const url = new URL(req.url)
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  let since: Date
  let until: Date
  let days: number
  if (fromParam && toParam && !Number.isNaN(Date.parse(fromParam)) && !Number.isNaN(Date.parse(toParam))) {
    since = new Date(fromParam)
    until = new Date(toParam)
    until.setHours(23, 59, 59, 999)
    days = Math.max(1, Math.ceil((until.getTime() - since.getTime()) / 86_400_000))
  } else {
    days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30))
    since = new Date(Date.now() - days * 86_400_000)
    until = new Date()
  }
  const brandFilter = url.searchParams.get('brandId')

  const data = await getTicketMetrics(db, {
    workspaceId,
    from: since,
    to: until,
    brandId: brandFilter ?? undefined,
  })

  return NextResponse.json({
    inactive: false,
    days,
    from: since.toISOString(),
    to: until.toISOString(),
    filters: { brandId: brandFilter ?? null },
    ...data,
  })
}
