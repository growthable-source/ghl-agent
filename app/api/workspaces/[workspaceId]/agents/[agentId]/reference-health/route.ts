/**
 * Read-only listing of an agent's reference health rows. Used by the
 * AgentReferenceHealthBanner component and the Tools page status badges.
 *
 * Auth: standard workspace membership check via requireWorkspaceAccess,
 * matching every other agent-scoped route in this repo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
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

  const references = await db.agentReferenceHealth.findMany({
    where: { agentId },
    select: {
      resourceType: true, resourceId: true, sourceField: true,
      status: true, lastError: true, lastCheckedAt: true, firstBrokenAt: true,
    },
    orderBy: { lastCheckedAt: 'desc' },
  })
  return NextResponse.json({ references })
}
