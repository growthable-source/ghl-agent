import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendPortalReport } from '@/lib/portal/report-email'
import { recordCronRun } from '@/lib/cron-heartbeat'

export const dynamic = 'force-dynamic'

/**
 * Hourly portal-report dispatcher. A portal is due when its frequency
 * interval has elapsed since reportLastSentAt (first send: immediately
 * after enabling, on the next hourly tick). The 23h/6.9d thresholds
 * (instead of exact 24h/7d) stop the send time from creeping later
 * every cycle. Secured by CRON_SECRET like the other crons.
 */
const DUE_MS: Record<string, number> = {
  daily: 23 * 3_600_000,
  weekly: 6.9 * 86_400_000,
}
const WINDOW_DAYS: Record<string, number> = { daily: 1, weekly: 7 }

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided = req.nextUrl.searchParams.get('secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // .catch: reportFrequency column may not exist pre-migration.
  const portals = await db.portal.findMany({
    where: { isActive: true, reportFrequency: { in: ['daily', 'weekly'] } },
    select: { id: true, reportFrequency: true, reportLastSentAt: true },
  }).catch(() => [])

  let sent = 0, failed = 0, skippedNotDue = 0
  for (const p of portals) {
    const dueAfter = DUE_MS[p.reportFrequency]
    if (!dueAfter) continue
    if (p.reportLastSentAt && Date.now() - p.reportLastSentAt.getTime() < dueAfter) {
      skippedNotDue++
      continue
    }
    try {
      const result = await sendPortalReport(p.id, {
        windowDays: WINDOW_DAYS[p.reportFrequency] ?? 7,
        context: 'portal-report-cron',
      })
      // Stamp even zero-recipient sends so a portal with no users doesn't
      // get re-evaluated every hour forever.
      await db.portal.update({ where: { id: p.id }, data: { reportLastSentAt: new Date() } }).catch(() => {})
      if (result.sent > 0) sent++
    } catch (err: any) {
      failed++
      console.warn('[PortalReports] portal', p.id, 'failed:', err?.message)
    }
  }
  await recordCronRun('portal-reports', failed === 0).catch(() => {})
  return NextResponse.json({ portals: portals.length, sent, failed, skippedNotDue })
}
