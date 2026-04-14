import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const sequences = await db.followUpSequence.findMany({
    where: { agentId },
    include: { steps: { orderBy: { stepNumber: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ sequences })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const sequence = await db.$transaction(async (tx) => {
    const seq = await tx.followUpSequence.create({
      data: {
        agentId,
        name: body.name,
        isActive: body.isActive ?? true,
        triggerType: body.triggerType ?? 'always',
        triggerValue: body.triggerValue ?? null,
      },
    })
    if (body.steps && Array.isArray(body.steps) && body.steps.length > 0) {
      await tx.followUpStep.createMany({
        data: body.steps.map((s: { stepNumber: number; delayHours: number; message: string }) => ({
          sequenceId: seq.id,
          stepNumber: s.stepNumber,
          delayHours: s.delayHours,
          message: s.message,
        })),
      })
    }
    return tx.followUpSequence.findUnique({
      where: { id: seq.id },
      include: { steps: { orderBy: { stepNumber: 'asc' } } },
    })
  })
  return NextResponse.json({ sequence }, { status: 201 })
}
