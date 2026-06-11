/**
 * GET /api/admin/cron-health
 *
 * Ground truth for "are the background jobs alive?". Reads the
 * CronHeartbeat rows and flags anything stale (no success within 3×
 * its expected cadence) or failing repeatedly. Auth: any signed-in
 * user (it exposes job names and error strings, no tenant data) —
 * matches the other /api/admin read endpoints.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

// Expected cadence per cron (minutes) — mirrors vercel.json. A cron
// missing from this map gets the conservative default.
const CADENCE_MIN: Record<string, number> = {
  'stale-conversations': 1,
  'process-simulations': 1,
  'native-outbox': 1,
  'ingest-queue': 1,
  'copilot-stale-sessions': 10,
  'refresh-tokens': 30,
  recrawl: 60,
  'agent-reference-health': 60,
  'follow-ups': 24 * 60,
  'crawl-schedules': 24 * 60,
  'prune-audit-log': 24 * 60,
  'sync-ad-metrics': 24 * 60,
  'cleanup-expired-invites': 24 * 60,
  'tickets-auto-close': 24 * 60,
  'experiment-proposer': 7 * 24 * 60,
  'weekly-digest': 7 * 24 * 60,
}
const DEFAULT_CADENCE_MIN = 24 * 60

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let rows
  try {
    rows = await db.cronHeartbeat.findMany({ orderBy: { name: 'asc' } })
  } catch {
    return NextResponse.json({ error: 'migration_pending' }, { status: 503 })
  }

  const now = Date.now()
  const crons = rows.map(r => {
    const cadenceMin = CADENCE_MIN[r.name] ?? DEFAULT_CADENCE_MIN
    const staleAfterMs = cadenceMin * 60 * 1000 * 3
    const lastSuccess = r.lastSuccessAt?.getTime() ?? 0
    const stale = now - lastSuccess > staleAfterMs
    return {
      name: r.name,
      lastRunAt: r.lastRunAt.toISOString(),
      lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null,
      consecutiveFailures: r.consecutiveFailures,
      lastError: r.lastError,
      stale,
      failing: r.consecutiveFailures >= 3,
    }
  })

  return NextResponse.json({
    ok: crons.every(c => !c.stale && !c.failing),
    crons,
    // Crons that have NEVER reported are also a signal — list the
    // known names with no heartbeat row at all.
    neverReported: Object.keys(CADENCE_MIN).filter(n => !rows.some(r => r.name === n)),
  })
}
