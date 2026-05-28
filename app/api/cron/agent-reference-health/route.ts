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

  // Concurrency + per-agent timeout. Previously the cron walked agents
  // sequentially — a 5s GHL hiccup on one agent stalled the rest, and
  // on workspaces with 100+ agents the whole sweep blew past Vercel's
  // 60s function limit, silently truncating the tail. Chunks of 8 +
  // a 12s per-agent timeout keeps the worst-case total bounded:
  // ~(candidates / 8) * 12s = ~75 agents per 60s budget.
  const PER_AGENT_TIMEOUT_MS = 12_000
  const CHUNK_SIZE = 8

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = setTimeout(() => reject(new Error(`per-agent timeout after ${ms}ms`)), ms)
      p.then(v => { clearTimeout(id); resolve(v) }, e => { clearTimeout(id); reject(e) })
    })
  }

  let processed = 0, broken = 0, healthy = 0, errors = 0
  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE)
    const results = await Promise.allSettled(
      chunk.map(agent =>
        withTimeout(runReferenceHealthCheck(agent.id, { throttleMinutes: 30 }), PER_AGENT_TIMEOUT_MS)
          .then(r => ({ agentId: agent.id, ok: true as const, ...r }))
          .catch(err => ({ agentId: agent.id, ok: false as const, message: err?.message ?? 'unknown' })),
      ),
    )
    for (const r of results) {
      if (r.status !== 'fulfilled') {
        // Should not happen — both branches above already settle — but
        // defensive in case allSettled itself rejects on a host issue.
        errors++
        continue
      }
      const v = r.value
      if (v.ok) {
        processed++
        broken += v.broken
        healthy += v.healthy
      } else {
        errors++
        console.error(`[cron ref-health] ${v.agentId}: ${v.message}`)
      }
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    processed, broken, healthy, errors,
    totalCandidates: candidates.length,
  })
}
