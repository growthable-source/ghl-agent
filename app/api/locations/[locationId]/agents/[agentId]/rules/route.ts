import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const rules = await db.routingRule.findMany({
    where: { agentId },
    orderBy: { priority: 'asc' },
  })
  return NextResponse.json({ rules })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
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
