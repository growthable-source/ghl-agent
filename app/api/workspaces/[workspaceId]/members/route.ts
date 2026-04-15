import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

/**
 * GET /api/workspaces/:id/members — list workspace members
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const members = await db.workspaceMember.findMany({
    where: { workspaceId },
    include: {
      user: { select: { id: true, name: true, email: true, image: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ members })
}

/**
 * PATCH /api/workspaces/:id/members — update workspace details (name, icon)
 * Only owners and admins can update.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Only owners and admins can update workspace settings' }, { status: 403 })
  }

  const body = await req.json()
  const data: Record<string, unknown> = {}

  if (body.name && typeof body.name === 'string') {
    data.name = body.name.trim().slice(0, 100)
  }
  if (body.icon && typeof body.icon === 'string') {
    data.icon = body.icon.trim().slice(0, 4)
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const workspace = await db.workspace.update({
    where: { id: workspaceId },
    data,
  })

  return NextResponse.json({ workspace })
}
