import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string; ruleId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, ruleId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  const rule = await (db as any).agentRule.update({
    where: { id: ruleId },
    data: {
      ...(body.name !== undefined && { name: String(body.name).trim() }),
      ...(body.conditionDescription !== undefined && { conditionDescription: String(body.conditionDescription).trim() }),
      ...(body.examples !== undefined && { examples: Array.isArray(body.examples) ? body.examples.filter((e: any) => typeof e === 'string' && e.trim()) : [] }),
      ...(body.actionType !== undefined && { actionType: String(body.actionType) }),
      ...(body.actionParams !== undefined && { actionParams: body.actionParams }),
      ...(body.targetFieldKey !== undefined && { targetFieldKey: String(body.targetFieldKey).trim() }),
      ...(body.targetValue !== undefined && { targetValue: String(body.targetValue) }),
      ...(body.overwrite !== undefined && { overwrite: !!body.overwrite }),
      ...(body.isActive !== undefined && { isActive: !!body.isActive }),
      ...(body.order !== undefined && { order: Number(body.order) }),
    },
  })
  return NextResponse.json({ rule })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, ruleId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await (db as any).agentRule.delete({ where: { id: ruleId } })
  return NextResponse.json({ success: true })
}
