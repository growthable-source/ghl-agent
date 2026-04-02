import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const rules = await db.routingRule.findMany({
    where: { agentId },
    orderBy: { priority: 'asc' },
  })
  return NextResponse.json({ rules })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const body = await req.json()
  const rule = await db.routingRule.create({
    data: {
      agentId,
      ruleType: body.ruleType,
      value: body.value ?? null,
      priority: body.ruleType === 'ALL' ? 999 : (body.priority ?? 10),
    },
  })
  return NextResponse.json({ rule }, { status: 201 })
}
