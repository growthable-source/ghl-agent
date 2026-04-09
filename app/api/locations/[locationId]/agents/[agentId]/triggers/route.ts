import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { SUPPORTED_CHANNELS } from '@/types'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const triggers = await db.agentTrigger.findMany({
    where: { agentId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ triggers })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const body = await req.json()

  const VALID_EVENTS = ['ContactCreate', 'ContactTagUpdate']
  const VALID_MODES = ['FIXED', 'AI_GENERATE']

  if (!VALID_EVENTS.includes(body.eventType)) {
    return NextResponse.json({ error: 'Invalid eventType' }, { status: 400 })
  }
  if (body.channel && !SUPPORTED_CHANNELS.includes(body.channel)) {
    return NextResponse.json({ error: 'Invalid channel' }, { status: 400 })
  }
  if (body.messageMode && !VALID_MODES.includes(body.messageMode)) {
    return NextResponse.json({ error: 'Invalid messageMode' }, { status: 400 })
  }
  if (body.messageMode === 'FIXED' && !body.fixedMessage?.trim()) {
    return NextResponse.json({ error: 'fixedMessage is required for FIXED mode' }, { status: 400 })
  }

  const trigger = await db.agentTrigger.create({
    data: {
      agentId,
      eventType: body.eventType,
      tagFilter: body.tagFilter || null,
      channel: body.channel || 'SMS',
      messageMode: body.messageMode || 'AI_GENERATE',
      fixedMessage: body.fixedMessage || null,
      aiInstructions: body.aiInstructions || null,
      delaySeconds: body.delaySeconds ?? 0,
      isActive: body.isActive ?? true,
    },
  })

  return NextResponse.json({ trigger }, { status: 201 })
}
