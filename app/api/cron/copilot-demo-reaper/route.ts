import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { DEMO_MAX_SECS, endCopilotSession } from '@/lib/copilot/session-service'
import { removeMeetingBot } from '@/lib/copilot/recall'
import { recordCronRun } from '@/lib/cron-heartbeat'

/**
 * Pull public "Try Now" demo bots out of their meeting once they hit the
 * 10-minute cap. This is the AUTHORITATIVE time kill — the token cap stops
 * the agent's brain and the visitor's tab can end early, but neither is
 * guaranteed (closed laptop, bot stuck in a waiting room), and every extra
 * minute a demo bot lingers is a paid Recall minute. Runs every minute, so
 * a demo leaves the call at DEMO_MAX_SECS + at most ~GRACE_SECS + 60s.
 *
 * Scoped to demo sessions only (metadata.demo) — staff meeting bots have
 * their own larger budget and the copilot-stale-sessions sweep.
 */

const GRACE_SECS = 30
const MAX_PER_RUN = 25

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - (DEMO_MAX_SECS + GRACE_SECS) * 1000)
  const stale = await db.copilotSession.findMany({
    where: {
      channel: 'recall_meeting_bot',
      status: 'active',
      startedAt: { lt: cutoff },
      metadata: { path: ['demo'], equals: true },
    },
    select: { id: true, roomId: true },
    take: MAX_PER_RUN,
  })

  let reaped = 0
  for (const session of stale) {
    try {
      if (session.roomId) await removeMeetingBot(session.roomId)
      await endCopilotSession(session.id, 'demo_timeout')
      reaped++
    } catch (err) {
      console.error(`[Demo reaper] failed for ${session.id}:`, err)
    }
  }

  await recordCronRun('copilot-demo-reaper', true)
  return NextResponse.json({ ok: true, reaped })
}
