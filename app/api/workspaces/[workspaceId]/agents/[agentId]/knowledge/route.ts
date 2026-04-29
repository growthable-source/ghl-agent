import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createKnowledgeForAgent, getAttachedKnowledgeForAgent } from '@/lib/knowledge'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * GET — knowledge currently attached (via the AgentKnowledge junction)
 * to this specific agent. The new top-level `/workspaces/[id]/knowledge`
 * page is where entries live; this view is the per-agent slice.
 *
 * POST — create a new entry in the agent's workspace and attach it to
 * this agent (so existing flows like "Write" / file upload feel
 * unchanged). The entry shows up in the workspace pool too — that's
 * the whole point.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const entries = await getAttachedKnowledgeForAgent(agentId)
  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Verify the agent belongs to this workspace.
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const body = await req.json()
  const allowedSources = ['manual', 'qa', 'notion', 'youtube', 'url']
  const source = typeof body.source === 'string' && allowedSources.includes(body.source)
    ? body.source
    : 'manual'
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl : null
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content : ''
  if (!title || !content) {
    return NextResponse.json({ error: 'title and content required' }, { status: 400 })
  }

  try {
    const entry = await createKnowledgeForAgent({
      agentId, title, content, source, sourceUrl,
    })
    return NextResponse.json({ entry }, { status: 201 })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({
        error: 'Knowledge migration pending — run prisma/migrations/20260429140000_workspace_knowledge/migration.sql.',
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    return NextResponse.json({ error: err.message || 'Create failed' }, { status: 500 })
  }
}
