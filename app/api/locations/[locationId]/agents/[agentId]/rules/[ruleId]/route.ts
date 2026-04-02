import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ ruleId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { ruleId } = await params
  const body = await req.json()
  const rule = await db.routingRule.update({
    where: { id: ruleId },
    data: {
      ...(body.ruleType !== undefined && { ruleType: body.ruleType }),
      ...(body.value !== undefined && { value: body.value }),
      ...(body.priority !== undefined && { priority: body.priority }),
    },
  })
  return NextResponse.json({ rule })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { ruleId } = await params
  await db.routingRule.delete({ where: { id: ruleId } })
  return NextResponse.json({ success: true })
}
