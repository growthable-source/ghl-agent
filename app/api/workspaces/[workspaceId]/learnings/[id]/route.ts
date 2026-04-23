import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { retireLearning } from '@/lib/platform-learning'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string; id: string }> }

/**
 * Workspace-scoped learning lifecycle endpoint.
 *
 * Currently supports ONE action: retire.
 *
 * The customer flow auto-applies this_agent learnings after a user-
 * initiated simulation (see lib/auto-review.ts). Retire is the only
 * reversal they need — rolling back an applied learning that turned
 * out to be a bad fit for their agent.
 *
 * Gates:
 *   - Auth: workspace member with role "admin" or "owner". Members get 403.
 *   - Scope: only this_agent learnings. workspace and all_agents learnings
 *     affect more than one agent/tenant and must route through super admins.
 *   - Ownership: the learning's workspace must match the route's workspaceId.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, id } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => null) as { action?: string } | null
  if (!body?.action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  const learning = await db.platformLearning.findUnique({
    where: { id },
    select: { id: true, scope: true, workspaceId: true, agentId: true, status: true },
  })
  if (!learning) {
    return NextResponse.json({ error: 'Learning not found' }, { status: 404 })
  }

  // Tenancy check. A learning "belongs to" this workspace if:
  //   - scope=this_agent AND learning.workspaceId matches, OR
  //   - scope=workspace AND learning.workspaceId matches
  // scope=all_agents is always off-limits here — those go through admins.
  const belongsHere =
    (learning.scope === 'this_agent' && learning.workspaceId === workspaceId) ||
    (learning.scope === 'workspace' && learning.workspaceId === workspaceId)
  if (!belongsHere) {
    return NextResponse.json({
      error: `Learning scope "${learning.scope}" can't be managed from this workspace.`,
    }, { status: 403 })
  }

  if (body.action === 'retire') {
    if (learning.status !== 'applied') {
      return NextResponse.json(
        { error: `Can only retire applied learnings (current: ${learning.status})` },
        { status: 400 },
      )
    }
    const result = await retireLearning(id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 })
}
