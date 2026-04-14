import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string; sequenceId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, sequenceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const sequence = await db.followUpSequence.update({
    where: { id: sequenceId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.triggerType !== undefined && { triggerType: body.triggerType }),
      ...(body.triggerValue !== undefined && { triggerValue: body.triggerValue }),
    },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  })
  return NextResponse.json({ sequence })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, sequenceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await db.followUpSequence.delete({ where: { id: sequenceId } })
  return NextResponse.json({ success: true })
}
