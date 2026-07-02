import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncAgencyLocations } from '@/lib/leadconnector-agency'
import { recordCronRun } from '@/lib/cron-heartbeat'

export const dynamic = 'force-dynamic'

/**
 * Daily agency-location sync. Keeps AgencyLocation rows current with the
 * agency (new sub-accounts appear with widgetEnabled=true; vanished ones
 * get removedAt stamped). Also exercises the token-refresh path so a
 * quiet connection doesn't sit on a dead token.
 * Secured by CRON_SECRET — matches the other crons.
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

  const connections = await db.agencyConnection.findMany({ select: { id: true } })
  let ok = 0, failed = 0
  for (const c of connections) {
    try {
      await syncAgencyLocations(c.id)
      ok++
    } catch (err: any) {
      failed++
      console.warn('[SyncAgencyLocations] connection', c.id, 'failed:', err?.message)
    }
  }
  await recordCronRun('sync-agency-locations', failed === 0).catch(() => {})
  return NextResponse.json({ connections: connections.length, ok, failed })
}
