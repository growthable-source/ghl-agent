/**
 * GET /api/workspaces/[workspaceId]/agents/[agentId]/flow
 *
 * Returns the FlowResponse — every node + edge for the visual workflow
 * canvas. Read-only in Phase 1; the canvas renders directly without
 * mutating anything except (eventually) AgentNodeLayout via the
 * sibling POST endpoints.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { buildAgentFlow } from '@/lib/agent/flow/build'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const flow = await buildAgentFlow(agentId)
  return NextResponse.json(flow)
}
