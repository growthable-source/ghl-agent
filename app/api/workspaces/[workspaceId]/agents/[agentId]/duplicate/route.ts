import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { canCreateAgent } from '@/lib/plans'
import { isInternalWorkspace } from '@/lib/internal-workspace'
import { snapshotAgent, restoreAgent } from '@/lib/agent-clone'

/**
 * POST /api/workspaces/:ws/agents/:agentId/duplicate
 *
 * Creates a deep copy of the agent in the same workspace, with " (Copy)"
 * appended to the name. Respects the plan's agent limit (internal
 * workspaces bypass, same as /agents POST). Cloned agents always land
 * paused so nobody accidentally doubles their outbound volume.
 *
 * Body:
 *   { name?: string }  — optional override; defaults to "<original> (Copy)"
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; agentId: string }> },
) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => ({})) as { name?: string }

  // Sanity: agent belongs to this workspace
  const source = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true, name: true, locationId: true },
  })
  if (!source) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  // Respect the agent limit unless the workspace is internal
  const internal = await isInternalWorkspace(workspaceId)
  if (!internal) {
    try {
      const workspace = await db.workspace.findUnique({
        where: { id: workspaceId },
        select: { plan: true, extraAgentCount: true, agentLimit: true },
      })
      if (workspace) {
        const currentAgentCount = await db.agent.count({ where: { workspaceId } })
        if (!canCreateAgent(workspace.plan, currentAgentCount, workspace.extraAgentCount ?? 0)) {
          return NextResponse.json({
            error: `Agent limit reached (${currentAgentCount}/${workspace.agentLimit}). Upgrade your plan or add extra agent slots.`,
            code: 'AGENT_LIMIT',
          }, { status: 403 })
        }
      }
    } catch {}
  }

  const snapshot = await snapshotAgent(agentId)
  const newName = body.name?.trim() || `${source.name} (Copy)`

  const newId = await restoreAgent({
    snapshot,
    workspaceId,
    // Inherit the source agent's Location so phone webhooks etc. still
    // route to the same CRM tenant.
    locationId: source.locationId,
    name: newName,
  })

  const agent = await db.agent.findUnique({ where: { id: newId } })
  return NextResponse.json({ agent }, { status: 201 })
}
