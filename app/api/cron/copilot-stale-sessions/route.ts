import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { COPILOT_DEFAULTS } from '@/lib/copilot/config'
import { getWorkspaceSetupState } from '@/lib/copilot/setup-state'
import { getWorkflow } from '@/lib/copilot/workflows'

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
 * Swept sessions still get the auto task_success eval record (same
 * check the PATCH path runs) so abandoned sessions don't silently
 * drop out of the §12 task-success metric.
 */

const GRACE_SECS = 300
const MAX_PER_RUN = 100

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - (COPILOT_DEFAULTS.maxSessionSecs + GRACE_SECS) * 1000)
  const stale = await db.copilotSession.findMany({
    where: { status: 'active', startedAt: { lt: cutoff } },
    select: { id: true, workspaceId: true, workflowKey: true, startedAt: true },
    take: MAX_PER_RUN,
  })

  let swept = 0
  for (const session of stale) {
    const endedAt = new Date()
    await db.copilotSession.update({
      where: { id: session.id },
      data: {
        status: 'ended',
        endedAt,
        endedReason: 'stale_sweep',
        // Cap at the ceiling — the user wasn't actually live for the
        // whole wall-clock gap, and cost counters already reflect the
        // real streamed seconds.
        durationSecs: COPILOT_DEFAULTS.maxSessionSecs,
      },
    })
    try {
      const state = await getWorkspaceSetupState(session.workspaceId)
      const workflow = getWorkflow(session.workflowKey)
      const taskSuccess = workflow.goalReached(state)
      await db.copilotEvalRecord.create({
        data: {
          sessionId: session.id,
          workspaceId: session.workspaceId,
          scope: 'session',
          taskSuccess,
          notes: `auto (stale sweep): workflow=${workflow.key} goal ${taskSuccess ? 'reached' : 'not reached'}`,
        },
      })
    } catch (err) {
      console.error(`[Copilot sweep] eval failed for ${session.id}:`, err)
    }
    swept++
  }

  return NextResponse.json({ ok: true, swept })
}
