import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ locationId: string; agentId: string; sequenceId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { sequenceId } = await params
  const body = await req.json()
  const sequence = await db.followUpSequence.update({
    where: { id: sequenceId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
  })
  return NextResponse.json({ sequence })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { sequenceId } = await params
  await db.followUpSequence.delete({ where: { id: sequenceId } })
  return NextResponse.json({ success: true })
}
