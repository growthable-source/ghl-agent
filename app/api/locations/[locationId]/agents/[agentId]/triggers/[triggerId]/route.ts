import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ locationId: string; agentId: string; triggerId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { triggerId } = await params
  const body = await req.json()

  const updateData: Record<string, any> = {}
  if (body.isActive !== undefined) updateData.isActive = body.isActive
  if (body.eventType !== undefined) updateData.eventType = body.eventType
  if (body.tagFilter !== undefined) updateData.tagFilter = body.tagFilter || null
  if (body.channel !== undefined) updateData.channel = body.channel
  if (body.messageMode !== undefined) updateData.messageMode = body.messageMode
  if (body.fixedMessage !== undefined) updateData.fixedMessage = body.fixedMessage || null
  if (body.aiInstructions !== undefined) updateData.aiInstructions = body.aiInstructions || null
  if (body.delaySeconds !== undefined) updateData.delaySeconds = body.delaySeconds

  const trigger = await db.agentTrigger.update({
    where: { id: triggerId },
    data: updateData,
  })

  return NextResponse.json({ trigger })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { triggerId } = await params
  await db.agentTrigger.delete({ where: { id: triggerId } })
  return NextResponse.json({ success: true })
}
