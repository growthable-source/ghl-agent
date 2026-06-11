import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { COPILOT_DEFAULTS } from '@/lib/copilot/config'
import { endCopilotSession } from '@/lib/copilot/session-service'

/**
 * Sweep abandoned Co-Pilot sessions.
 *
 * The happy path ends a session via PATCH (user clicks End, or the
 * client's countdown fires) and the event-sink auth flips expired
 * sessions on the next write. But a closed laptop lid or killed tab
 * produces neither — the row stays 'active' forever and pollutes any
 * "active sessions" count. This sweep closes sessions that have been
 * running past the max duration plus a grace window.
 *
 * Uses the shared endCopilotSession, so swept sessions get the same
 * post-session treatment as clean ends: workflow-goal eval (staff),
 * Haiku transcript analysis, and an auto-ticket when the visitor's
 * issue went unresolved — abandoned sessions are MORE likely to be
 * unresolved, so skipping them would bias the §12 metric upward.
 */

const GRACE_SECS = 300
const MAX_PER_RUN = 25

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - (COPILOT_DEFAULTS.maxSessionSecs + GRACE_SECS) * 1000)
  const stale = await db.copilotSession.findMany({
    where: { status: 'active', startedAt: { lt: cutoff } },
    select: { id: true },
    take: MAX_PER_RUN,
  })

  let swept = 0
  for (const session of stale) {
    try {
      await endCopilotSession(session.id, 'stale_sweep')
      swept++
    } catch (err) {
      console.error(`[Copilot sweep] failed for ${session.id}:`, err)
    }
  }

  return NextResponse.json({ ok: true, swept })
}
