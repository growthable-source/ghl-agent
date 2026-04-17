import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; goalId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, goalId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}

  const goal = await db.agentGoal.update({
    where: { id: goalId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.value !== undefined && { value: body.value }),
      ...(body.maxTurns !== undefined && { maxTurns: body.maxTurns }),
    },
  })
  return NextResponse.json({ goal })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, goalId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  await db.agentGoal.delete({ where: { id: goalId } })
  return NextResponse.json({ success: true })
}
