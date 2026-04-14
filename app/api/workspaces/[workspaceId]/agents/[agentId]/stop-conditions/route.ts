import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const conditions = await db.stopCondition.findMany({
    where: { agentId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ conditions })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const condition = await db.stopCondition.create({
    data: {
      agentId,
      conditionType: body.conditionType,
      value: body.value ?? null,
      pauseAgent: body.pauseAgent ?? true,
    },
  })
  return NextResponse.json({ condition }, { status: 201 })
}
