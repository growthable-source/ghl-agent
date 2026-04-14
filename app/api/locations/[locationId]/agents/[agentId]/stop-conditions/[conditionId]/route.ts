import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

type Params = { params: Promise<{ locationId: string; agentId: string; conditionId: string }> }

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { locationId, conditionId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  await db.stopCondition.delete({ where: { id: conditionId } })
  return NextResponse.json({ success: true })
}
