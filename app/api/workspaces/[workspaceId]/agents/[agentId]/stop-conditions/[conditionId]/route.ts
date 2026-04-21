import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string; conditionId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, conditionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  // Field-by-field — we only update what's present so the UI can toggle
  // a single flag (e.g. tagNeedsAttention) without rewriting the whole row.
  const data: Record<string, any> = {}
  if (body.conditionType !== undefined) data.conditionType = body.conditionType
  if (body.value !== undefined) data.value = body.value || null
  if (body.pauseAgent !== undefined) data.pauseAgent = !!body.pauseAgent
  if (body.tagNeedsAttention !== undefined) data.tagNeedsAttention = !!body.tagNeedsAttention
  if (body.enrollWorkflowId !== undefined) data.enrollWorkflowId = body.enrollWorkflowId || null
  if (body.removeWorkflowId !== undefined) data.removeWorkflowId = body.removeWorkflowId || null
  const condition = await db.stopCondition.update({
    where: { id: conditionId },
    data,
  })
  return NextResponse.json({ condition })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, conditionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await db.stopCondition.delete({ where: { id: conditionId } })
  return NextResponse.json({ success: true })
}
