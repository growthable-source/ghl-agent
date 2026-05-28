/**
 * POST /api/workspaces/[workspaceId]/agents/[agentId]/flow/reset-layout
 *
 * Deletes every AgentNodeLayout row for the agent so the next GET /flow
 * returns pure dagre-computed positions. The canvas calls this from the
 * toolbar "Reset layout" button after a confirm dialog.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await db.agentNodeLayout.deleteMany({ where: { agentId } })
  return NextResponse.json({ ok: true })
}
