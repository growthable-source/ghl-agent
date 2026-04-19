import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string; ruleId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, ruleId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  const rule = await (db as any).agentListeningRule.update({
    where: { id: ruleId },
    data: {
      ...(body.name !== undefined && { name: String(body.name).trim() }),
      ...(body.description !== undefined && { description: String(body.description).trim() }),
      ...(body.examples !== undefined && { examples: Array.isArray(body.examples) ? body.examples.filter((e: any) => typeof e === 'string' && e.trim()) : [] }),
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
  await (db as any).agentListeningRule.delete({ where: { id: ruleId } })
  return NextResponse.json({ success: true })
}
