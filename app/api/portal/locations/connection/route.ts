import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

/**
 * DELETE /api/portal/locations/connection?widgetId=...
 *
 * Portal-side disconnect for a widget's agency connection — same
 * semantics as the dashboard route: blank the tokens, keep the synced
 * locations and every per-location toggle, so reconnecting the same
 * agency restores everything in place. The widget must belong to one of
 * the portal session's brands.
 */
export async function DELETE(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const widgetId = req.nextUrl.searchParams.get('widgetId')
  if (!widgetId) return NextResponse.json({ error: 'widgetId required' }, { status: 400 })

  const result = await db.agencyConnection.updateMany({
    where: { widgetId, widget: { brandId: { in: session.brandIds } } },
    data: { accessToken: '', refreshToken: '', tokenRefreshFailedAt: new Date() },
  }).catch(() => null)

  if (!result || result.count === 0) {
    return NextResponse.json({ error: 'No agency connection for this widget' }, { status: 404 })
  }
  return NextResponse.json({ disconnected: true })
}
