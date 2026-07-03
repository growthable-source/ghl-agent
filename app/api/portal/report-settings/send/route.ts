import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import { sendPortalReport } from '@/lib/portal/report-email'

/**
 * POST /api/portal/report-settings/send
 * "Send now": fires the report immediately to every included recipient
 * (receiveReports=true). Lets an admin (or the customer) push the report
 * on demand instead of waiting for the schedule. Stamps
 * reportLastSentAt so the cron doesn't double-send right after.
 */
export async function POST() {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await sendPortalReport(session.portalId, {
    windowDays: 7,
    context: 'portal-report-send-now',
  })
  if (result.sent > 0) {
    await db.portal.update({
      where: { id: session.portalId },
      data: { reportLastSentAt: new Date() },
    }).catch(() => {})
  }
  if (result.sent === 0) {
    return NextResponse.json({ error: result.skipped ?? 'Nothing sent — no included recipients yet' }, { status: 400 })
  }
  return NextResponse.json({ sent: result.sent })
}
