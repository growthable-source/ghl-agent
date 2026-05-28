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
  }> = []

  for (const agent of candidates) {
    try {
      const result = await runReferenceHealthCheck(agent.id, { throttleMinutes: 0 })
      processed++
      totalBroken += result.broken
      totalHealthy += result.healthy
      totalTransient += result.transient
      perAgent.push({ agentId: agent.id, name: agent.name, ...result })
    } catch (err: any) {
      errors++
      console.error(`[reference-health/recheck-all] ${agent.id}: ${err?.message}`)
      perAgent.push({
        agentId: agent.id, name: agent.name,
        healthy: 0, broken: 0, transient: 0, skipped: 0,
      })
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
