import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { snapshotAgent } from '@/lib/agent-clone'

/**
 * POST /api/workspaces/:ws/agents/:agentId/save-as-template
 *
 * Snapshots the agent's full config and persists it as a workspace-scoped
 * AgentTemplate row. Only visible inside this workspace — no leakage to
 * other tenants.
 *
 * Body:
 *   { name?: string, description?: string, category?: string, icon?: string }
 * Defaults the name to "<agent name> template" and category to 'custom'
 * when the caller doesn't supply them.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; agentId: string }> },
) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => ({})) as {
    name?: string; description?: string; category?: string; icon?: string
  }

  // Confirm the agent belongs to this workspace — rules out tenant
  // confusion when someone passes another workspace's agent id.
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true, name: true, systemPrompt: true, enabledTools: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const snapshot = await snapshotAgent(agentId)
  const name = (body.name ?? `${agent.name} template`).trim()
  const description = (body.description ?? `Template saved from ${agent.name}`).trim()
  const category = (body.category ?? 'custom').trim()
  const icon = (body.icon ?? '🤖').trim()

  // Slug needs to be globally unique on AgentTemplate. Prefix with the
  // workspace id to avoid collisions with official templates / other
  // workspaces' saves. Append a timestamp so re-saving the same agent
  // multiple times yields multiple distinct templates.
  const slug = `ws-${workspaceId.slice(0, 8)}-${agent.id.slice(0, 8)}-${Date.now().toString(36)}`

  const template = await db.agentTemplate.create({
    data: {
      slug, name, description, category, icon,
      // Flat fields kept so the existing template browser still works
      // without knowing about the richer config blob.
      systemPrompt: agent.systemPrompt,
      suggestedTools: agent.enabledTools,
      isOfficial: false,
      workspaceId,
      sourceAgentId: agent.id,
      config: snapshot as any,
    },
  })

  return NextResponse.json({ template }, { status: 201 })
}
