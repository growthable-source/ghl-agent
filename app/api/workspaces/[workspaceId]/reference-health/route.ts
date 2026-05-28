/**
 * Workspace-wide connectivity check. Sweeps every agent in the workspace
 * that has at least one CRM resource reference (calendar, workflow, etc.)
 * and runs the reference-health validator with NO throttle so the operator
 * gets an immediate, comprehensive answer about whether their CRM wiring
 * is still working.
 *
 * Equivalent to the hourly cron at /api/cron/agent-reference-health but
 * scoped to a single workspace and auth'd via workspace membership rather
 * than the cron secret. The button on the integrations page calls this.
 *
 * Returns a summary plus a per-agent breakdown so the UI can either show
 * a single rollup ("3 broken across 8 agents") or drill into specifics.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { runReferenceHealthCheck } from '@/lib/agent/reference-health/check'

type Params = { params: Promise<{ workspaceId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Same candidate selection as the cron job — only agents that actually
  // reference something we know how to validate. Avoids wasting cycles on
  // agents that are pure messaging with no CRM resources.
  const candidates = await db.agent.findMany({
    where: {
      workspaceId,
      OR: [
        { calendarId: { not: null } },
        { stopConditions: { some: { enrollWorkflowId: { not: null } } } },
        { stopConditions: { some: { removeWorkflowId: { not: null } } } },
      ],
    },
    select: { id: true, name: true },
  })

  let processed = 0
  let totalBroken = 0
  let totalHealthy = 0
  let totalTransient = 0
  let errors = 0
  const perAgent: Array<{
    agentId: string
    name: string
    healthy: number
    broken: number
    transient: number
    skipped: number
    /** Populated when this agent's check itself failed; absent on success. */
    error?: string
  }> = []

  // Same chunking + per-agent timeout as the hourly cron. One slow
  // GHL response no longer stalls the entire workspace sweep.
  const PER_AGENT_TIMEOUT_MS = 12_000
  const CHUNK_SIZE = 8

  function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = setTimeout(() => reject(new Error(`per-agent timeout after ${ms}ms`)), ms)
      p.then(v => { clearTimeout(id); resolve(v) }, e => { clearTimeout(id); reject(e) })
    })
  }

  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    const chunk = candidates.slice(i, i + CHUNK_SIZE)
    const results = await Promise.allSettled(
      chunk.map(agent =>
        withTimeout(runReferenceHealthCheck(agent.id, { throttleMinutes: 0 }), PER_AGENT_TIMEOUT_MS)
          .then(r => ({ agent, ok: true as const, ...r }))
          .catch(err => ({ agent, ok: false as const, message: err?.message ?? 'unknown' })),
      ),
    )
    for (const r of results) {
      if (r.status !== 'fulfilled') {
        errors++
        continue
      }
      const v = r.value
      if (v.ok) {
        processed++
        totalBroken += v.broken
        totalHealthy += v.healthy
        totalTransient += v.transient
        perAgent.push({
          agentId: v.agent.id, name: v.agent.name,
          healthy: v.healthy, broken: v.broken, transient: v.transient, skipped: v.skipped,
        })
      } else {
        errors++
        console.error(`[reference-health/recheck-all] ${v.agent.id}: ${v.message}`)
        perAgent.push({
          agentId: v.agent.id, name: v.agent.name,
          healthy: 0, broken: 0, transient: 0, skipped: 0,
          error: v.message,
        })
      }
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    totalCandidates: candidates.length,
    processed,
    healthy: totalHealthy,
    broken: totalBroken,
    transient: totalTransient,
    errors,
    perAgent,
  })
}
