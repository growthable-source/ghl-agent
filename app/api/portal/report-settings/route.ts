import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

/**
 * GET/PATCH /api/portal/report-settings
 * The portal-side control for scheduled email reports. Any portal user
 * of the portal can read/set it (portal users are the customer's own
 * staff; there is deliberately no per-user role system here). The same
 * setting is also editable by us from the super-admin portal page.
 */
export async function GET() {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const portal = await db.portal.findUnique({
    where: { id: session.portalId },
    select: { reportFrequency: true, reportLastSentAt: true },
  }).catch(() => null)
  return NextResponse.json({
    reportFrequency: portal?.reportFrequency ?? 'off',
    reportLastSentAt: portal?.reportLastSentAt ?? null,
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any = {}
  try { body = await req.json() } catch {}
  const freq = body?.reportFrequency
  if (typeof freq !== 'string' || !['off', 'daily', 'weekly'].includes(freq)) {
    return NextResponse.json({ error: 'reportFrequency must be off, daily, or weekly' }, { status: 400 })
  }
  try {
    await db.portal.update({ where: { id: session.portalId }, data: { reportFrequency: freq } })
  } catch {
    return NextResponse.json({ error: 'Report settings need a database migration first' }, { status: 503 })
  }
  return NextResponse.json({ reportFrequency: freq })
}
