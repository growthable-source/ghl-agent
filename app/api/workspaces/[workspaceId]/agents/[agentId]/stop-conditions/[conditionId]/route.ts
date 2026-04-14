import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string; conditionId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, conditionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await db.stopCondition.delete({ where: { id: conditionId } })
  return NextResponse.json({ success: true })
}
