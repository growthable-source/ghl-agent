/**
 * Reset one tool's config back to catalog defaults. Deletes the
 * AgentToolConfig row entirely — the runtime falls back to catalog defaults
 * when no row exists.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { resolveOneToolConfig } from '@/lib/agent/tool-config'

type Params = { params: Promise<{ workspaceId: string; agentId: string; toolName: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId, toolName } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  try {
    await db.agentToolConfig.delete({
      where: { agentId_toolName: { agentId, toolName } },
    })
  } catch {
    // Row didn't exist — already at defaults. Idempotent.
  }
  const resolved = await resolveOneToolConfig(agentId, toolName)
  return NextResponse.json({ tool: resolved })
}
