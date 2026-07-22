import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { copyCollectionToWorkspace } from '@/lib/knowledge-sharing'

type Params = { params: Promise<{ workspaceId: string; collectionId: string }> }

/**
 * Copy a collection straight into another workspace the caller is
 * already a member of — the agency case, where no share code is
 * needed because the same person is on both sides.
 *
 * GET  — the workspaces this collection can be copied into (every
 *        workspace the caller belongs to, minus the source).
 * POST — do the copy. Body: { targetWorkspaceId, name? }
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const collection = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true },
  })
  if (!collection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const memberships = await db.workspaceMember.findMany({
    where: { userId: access.session.user!.id!, workspaceId: { not: workspaceId } },
    select: { role: true, workspace: { select: { id: true, name: true, icon: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    workspaces: memberships.map(m => ({
      id: m.workspace.id,
      name: m.workspace.name,
      icon: m.workspace.icon,
      role: m.role,
      // Copying writes into the destination, so viewers can't be a target.
      canReceive: ['owner', 'admin', 'member'].includes(m.role),
    })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const targetWorkspaceId = typeof body.targetWorkspaceId === 'string' ? body.targetWorkspaceId : ''
  if (!targetWorkspaceId) return NextResponse.json({ error: 'targetWorkspaceId required' }, { status: 400 })
  if (targetWorkspaceId === workspaceId) {
    return NextResponse.json({ error: 'Pick a different workspace.' }, { status: 400 })
  }

  const collection = await db.knowledgeCollection.findFirst({
    where: { id: collectionId, workspaceId },
    select: { id: true },
  })
  if (!collection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // The caller must be able to WRITE into the destination — membership
  // in the source is not enough.
  const target = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: access.session.user!.id!, workspaceId: targetWorkspaceId } },
    select: { role: true },
  })
  if (!target) {
    return NextResponse.json({ error: 'You are not a member of that workspace.' }, { status: 403 })
  }
  if (target.role === 'viewer') {
    return NextResponse.json({ error: 'You only have view access to that workspace.' }, { status: 403 })
  }

  const result = await copyCollectionToWorkspace({
    sourceCollectionId: collectionId,
    targetWorkspaceId,
    nameOverride: typeof body.name === 'string' ? body.name : null,
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ copied: result }, { status: 201 })
}
