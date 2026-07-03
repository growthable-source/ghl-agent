import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

/**
 * GET/PATCH /api/portal/report-settings
 * Portal-side control for scheduled email reports: the cadence AND the
 * per-user recipient list (PortalUser.receiveReports, default on). Any
 * portal user of the portal can manage it — portal users are the
 * customer's own staff, and admins reach this via the admin-preview
 * session. The same cadence is also editable from the super-admin
 * portal page.
 */
export async function GET() {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const portal = await db.portal.findUnique({
    where: { id: session.portalId },
    select: { reportFrequency: true, reportLastSentAt: true },
  }).catch(() => null)
  // Fallback select for DBs that haven't run the receiveReports ALTER.
  const users = await db.portalUser.findMany({
    where: { portalId: session.portalId },
    orderBy: { invitedAt: 'asc' },
    select: { id: true, email: true, name: true, isActive: true, acceptedAt: true, receiveReports: true },
  }).catch(() =>
    db.portalUser.findMany({
      where: { portalId: session.portalId },
      orderBy: { invitedAt: 'asc' },
      select: { id: true, email: true, name: true, isActive: true, acceptedAt: true },
    }).then(rows => rows.map(r => ({ ...r, receiveReports: true }))),
  )
  return NextResponse.json({
    reportFrequency: portal?.reportFrequency ?? 'weekly',
    reportLastSentAt: portal?.reportLastSentAt ?? null,
    users: users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      isActive: u.isActive,
      accepted: !!u.acceptedAt,
      receiveReports: u.receiveReports,
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: any = {}
  try { body = await req.json() } catch {}

  // Per-user recipient toggle.
  if (typeof body.userId === 'string' && typeof body.receiveReports === 'boolean') {
    try {
      const result = await db.portalUser.updateMany({
        where: { id: body.userId, portalId: session.portalId },
        data: { receiveReports: body.receiveReports },
      })
      if (result.count === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 })
      return NextResponse.json({ ok: true })
    } catch {
      return NextResponse.json({ error: 'Recipient settings need a database migration first' }, { status: 503 })
    }
  }

  // Cadence.
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
