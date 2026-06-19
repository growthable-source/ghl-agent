import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runMiningRun } from '@/lib/conversation-mining'
import { recordCronRun } from '@/lib/cron-heartbeat'

/**
 * Background worker for queued conversation Q&A mining runs.
 *
 * A run is created with status='queued' from the collection UI after the
 * operator confirms the cost estimate. This cron (every minute) claims one
 * run race-proof — UPDATE … WHERE status='queued' — and executes it under a
 * soft deadline. A run too big for one tick persists its cursor and stays
 * 'running'; the next tick resumes it from the cursor (re-claiming 'running'
 * rows that aren't zombies).
 *
 * One run per tick: each run can fan out to many CRM reads + LLM calls, and
 * keeping it to one keeps upstream rate limits and per-tick cost predictable.
 */

export const maxDuration = 300

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Reclaim zombies: a run stuck 'running' for 20+ minutes with no progress
  // means its function got killed mid-flight. We treat 'running' rows as
  // resumable (cursor persisted), but a genuinely dead one needs to fail so
  // the UI stops spinning. Heuristic: not touched (updatedAt) in 20 min.
  await db.conversationMiningRun.updateMany({
    where: { status: 'running', updatedAt: { lt: new Date(Date.now() - 20 * 60 * 1000) } },
    data: { status: 'failed', error: 'Run was interrupted (timed out). Re-run to continue — already-staged pairs are kept.' },
  })

  const tickStart = Date.now()

  // Oldest active run first (FIFO). A 'running' row here is one a prior tick
  // deadline-cut mid-window; re-claiming it resumes from its persisted cursor
  // until it completes, before newer 'queued' runs start.
  const next = await db.conversationMiningRun.findFirst({
    where: { status: { in: ['queued', 'running'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true },
  })

  if (!next) {
    await recordCronRun('mine-conversations', true)
    return NextResponse.json({ ok: true, processed: [] })
  }

  // Compare-and-swap claim from whichever state it was in.
  const claimed = await db.conversationMiningRun.updateMany({
    where: { id: next.id, status: next.status },
    data: { status: 'running' },
  })
  if (claimed.count === 0) {
    await recordCronRun('mine-conversations', true)
    return NextResponse.json({ ok: true, processed: [], note: 'lost race' })
  }

  try {
    // Leave ~60s of the 300s budget for bookkeeping / final write.
    const result = await runMiningRun(next.id, { deadlineAt: tickStart + 240_000 })
    await recordCronRun('mine-conversations', true)
    return NextResponse.json({ ok: true, processed: [{ runId: next.id, ...result }] })
  } catch (err) {
    await db.conversationMiningRun
      .update({
        where: { id: next.id },
        data: { status: 'failed', error: err instanceof Error ? err.message : String(err) },
      })
      .catch(() => undefined)
    await recordCronRun('mine-conversations', false, err instanceof Error ? err.message : String(err))
    return NextResponse.json({ ok: false, runId: next.id, error: 'run failed' }, { status: 500 })
  }
}
