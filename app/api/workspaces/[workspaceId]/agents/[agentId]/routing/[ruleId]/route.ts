import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; ruleId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, ruleId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  // If the caller sends `conditions`, we write the compound shape and clear
  // the legacy `value`. The required `ruleType` column is kept in sync with
  // the first clause so DB queries that still read ruleType (for display,
  // sorting, etc.) stay sensible.
  const conditions = body.conditions as
    | { clauses?: Array<{ ruleType: string; values?: string[] }> }
    | null
    | undefined

  const data: any = {
    ...(body.priority !== undefined && { priority: body.priority }),
  }

  if (conditions !== undefined) {
    data.conditions = conditions
    if (conditions?.clauses?.[0]?.ruleType) {
      data.ruleType = conditions.clauses[0].ruleType
    }
    data.value = null
  } else {
    if (body.ruleType !== undefined) data.ruleType = body.ruleType
    if (body.value !== undefined) data.value = body.value
  }

  const rule = await db.routingRule.update({
    where: { id: ruleId },
    data,
  })
  return NextResponse.json({ rule })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, ruleId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await db.routingRule.delete({ where: { id: ruleId } })
  return NextResponse.json({ success: true })
}
