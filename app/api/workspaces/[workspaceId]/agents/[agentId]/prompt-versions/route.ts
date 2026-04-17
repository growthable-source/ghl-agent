import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { audit } from '@/lib/audit'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

/**
 * GET — list all prompt versions for this agent, newest first.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const versions = await db.agentPromptVersion.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return NextResponse.json({ versions })
  } catch {
    return NextResponse.json({ versions: [], notMigrated: true })
  }
}

/**
 * POST — snapshot the current prompt (called by the client before saving changes).
 * Body: { systemPrompt, instructions, changeNote?, isRollback? }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  try {
    const version = await db.agentPromptVersion.create({
      data: {
        agentId,
        systemPrompt: body.systemPrompt ?? '',
        instructions: body.instructions ?? null,
        changeNote: body.changeNote ?? null,
        editedBy: access.session.user.id,
        isRollback: body.isRollback === true,
      },
    })
    await audit({
      workspaceId,
      actorId: access.session.user.id,
      action: body.isRollback ? 'agent.prompt.rollback' : 'agent.prompt.edit',
      targetType: 'agent',
      targetId: agentId,
      metadata: { versionId: version.id },
    })
    return NextResponse.json({ version })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to save version' }, { status: 500 })
  }
}
