/**
 * Manual "Re-check now" endpoint. Operator clicks the button on the broken
 * banner → we run the validator without throttle so they get an immediate
 * answer about whether their fix worked.
 *
 * Auth: standard workspace membership check via requireWorkspaceAccess,
 * matching every other agent-scoped route in this repo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { runReferenceHealthCheck } from '@/lib/agent/reference-health/check'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const result = await runReferenceHealthCheck(agentId, { throttleMinutes: 0 })
  const rows = await db.agentReferenceHealth.findMany({
    where: { agentId },
    select: {
      resourceType: true, resourceId: true, sourceField: true,
      status: true, lastError: true, lastCheckedAt: true,
    },
  })
  return NextResponse.json({ ...result, references: rows })
}
