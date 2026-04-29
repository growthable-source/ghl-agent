import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { bulkLoadKnowledgeForAgents } from '@/lib/knowledge'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * GET — every knowledge entry currently visible to this agent via its
 * attached collections. Read-only — creation lives at the workspace
 * level under /workspaces/:wid/knowledge/collections/[id]/entries.
 *
 * POST is intentionally removed from this path: agents no longer
 * "own" knowledge entries directly. Connect one or more collections
 * to the agent via PUT /workspaces/:wid/agents/:aid/collections, then
 * create entries inside those collections at the workspace level.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const map = await bulkLoadKnowledgeForAgents([agentId])
  const entries = map.get(agentId) ?? []
  return NextResponse.json({ entries })
}

export function POST() {
  return NextResponse.json({
    error: 'Knowledge is now created inside Collections at the workspace level. Use POST /workspaces/[id]/knowledge/collections/[collectionId]/entries.',
    code: 'AGENT_LEVEL_CREATE_REMOVED',
  }, { status: 410 })
}
