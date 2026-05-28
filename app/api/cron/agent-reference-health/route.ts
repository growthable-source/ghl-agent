/**
 * Hourly cron: walks every Agent that has at least one resource reference
 * and runs the reference health check. References checked within the last
 * 30 minutes (e.g. via the manual re-check button) are skipped via the
 * runReferenceHealthCheck throttle.
 *
 * Returns a summary so Vercel cron logs show whether the run was meaningful.
 *
 * Auth: same CRON_SECRET bearer-token pattern as every other cron in this
 * repo — see app/api/cron/stale-conversations/route.ts. The check is
 * skipped entirely when CRON_SECRET is unset so local dev `curl` still
 * works without env wrangling.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runReferenceHealthCheck } from '@/lib/agent/reference-health/check'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find every agent with at least one calendar or workflow ID set.
  const candidates = await db.agent.findMany({
    where: {
      OR: [
        { calendarId: { not: null } },
        { stopConditions: { some: { enrollWorkflowId: { not: null } } } },
        { stopConditions: { some: { removeWorkflowId: { not: null } } } },
      ],
    },
    select: { id: true, name: true, workspaceId: true },
  })

  let processed = 0, broken = 0, healthy = 0, errors = 0
  for (const agent of candidates) {
    try {
      const result = await runReferenceHealthCheck(agent.id, { throttleMinutes: 30 })
      processed++
      broken += result.broken
      healthy += result.healthy
    } catch (err: any) {
      errors++
      console.error(`[cron ref-health] ${agent.id}: ${err?.message}`)
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    processed, broken, healthy, errors,
    totalCandidates: candidates.length,
  })
}
