import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/next-actions
 * List all SCHEDULED follow-up jobs for this workspace, with agent + sequence details.
 *
 * Query params:
 *   - agentId: filter to a single agent
 *   - status: SCHEDULED (default) | SENT | CANCELLED | FAILED
 *   - limit: max rows (default 100, max 500)
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const agentId = url.searchParams.get('agentId')
  const status = (url.searchParams.get('status') || 'SCHEDULED') as 'SCHEDULED' | 'SENT' | 'CANCELLED' | 'FAILED'
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500)

  // Resolve workspace locations
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) {
    return NextResponse.json({ jobs: [], summary: { total: 0, byAgent: {} } })
  }

  // Build agent ID filter — restricted to this workspace
  const agentWhereClause = agentId
    ? { id: agentId, workspaceId }
    : { workspaceId }
  const workspaceAgents = await db.agent.findMany({
    where: agentWhereClause,
    select: { id: true, name: true, isActive: true },
  })
  const agentById = new Map(workspaceAgents.map(a => [a.id, a]))
  const agentIds = workspaceAgents.map(a => a.id)

  // Fetch jobs scoped to workspace via sequence→agent relationship
  const jobs = await db.followUpJob.findMany({
    where: {
      status,
      locationId: { in: locationIds },
      sequence: { agentId: { in: agentIds } },
    },
    include: {
      sequence: {
        select: {
          id: true,
          name: true,
          triggerType: true,
          agentId: true,
          steps: {
            orderBy: { stepNumber: 'asc' },
            select: { stepNumber: true, delayHours: true, message: true },
          },
        },
      },
    },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  })

  // Shape the response with agent info inlined and next-step preview
  const shaped = jobs.map(job => {
    const agent = agentById.get(job.sequence.agentId)
    const nextStep = job.sequence.steps.find(s => s.stepNumber === job.currentStep)
    const totalSteps = job.sequence.steps.length
    return {
      id: job.id,
      scheduledAt: job.scheduledAt,
      createdAt: job.createdAt,
      lastSentAt: job.lastSentAt,
      channel: job.channel,
      contactId: job.contactId,
      conversationId: job.conversationId,
      currentStep: job.currentStep,
      totalSteps,
      status: job.status,
      agent: agent ? { id: agent.id, name: agent.name, isActive: agent.isActive } : null,
      sequence: {
        id: job.sequence.id,
        name: job.sequence.name,
        triggerType: job.sequence.triggerType,
      },
      preview: nextStep?.message?.slice(0, 120) ?? null,
    }
  })

  // Aggregate summary counts per agent (only for scheduled status)
  const byAgent: Record<string, { count: number; nextAt: string | null; agentName: string }> = {}
  if (status === 'SCHEDULED') {
    for (const job of shaped) {
      if (!job.agent) continue
      const key = job.agent.id
      if (!byAgent[key]) {
        byAgent[key] = { count: 0, nextAt: null, agentName: job.agent.name }
      }
      byAgent[key].count++
      if (!byAgent[key].nextAt || new Date(job.scheduledAt) < new Date(byAgent[key].nextAt!)) {
        byAgent[key].nextAt = new Date(job.scheduledAt).toISOString()
      }
    }
  }

  return NextResponse.json({
    jobs: shaped,
    summary: {
      total: shaped.length,
      byAgent,
    },
  })
}
