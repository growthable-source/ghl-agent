import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuditRetentionDays } from '@/lib/system-settings'

export const dynamic = 'force-dynamic'
// Don't pre-render this on deploy — it's a side-effect cron only.
export const revalidate = 0

/**
 * Daily audit-log retention cron.
 *
 * Reads auditRetentionDays from SystemSetting. If null / unset, keeps
 * everything (default — compliance first). Otherwise deletes
 * AdminAuditLog rows where createdAt < now - retention days.
 *
 * Secured by CRON_SECRET — either as `?secret=` query or via Vercel's
 * standard Authorization: Bearer <CRON_SECRET> header.
 */
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

  const days = await getAuditRetentionDays()
  if (!days) {
    return NextResponse.json({ ok: true, skipped: 'no retention configured' })
  }

  const cutoff = new Date(Date.now() - days * 86_400_000)
  const { count } = await db.adminAuditLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })

  return NextResponse.json({ ok: true, retentionDays: days, deletedCount: count, cutoff: cutoff.toISOString() })
}
