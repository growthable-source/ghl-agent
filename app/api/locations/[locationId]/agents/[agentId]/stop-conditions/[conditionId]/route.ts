import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ locationId: string; agentId: string; conditionId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { conditionId } = await params
  await db.stopCondition.delete({ where: { id: conditionId } })
  return NextResponse.json({ success: true })
}
