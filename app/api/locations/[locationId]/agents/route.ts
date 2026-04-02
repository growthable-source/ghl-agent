import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const agents = await db.agent.findMany({
    where: { locationId },
    include: {
      _count: { select: { knowledgeEntries: true, routingRules: true, messageLogs: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ agents })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const body = await req.json()
  const agent = await db.agent.create({
    data: {
      locationId,
      name: body.name,
      systemPrompt: body.systemPrompt,
      instructions: body.instructions ?? null,
      ...(body.enabledTools !== undefined && { enabledTools: body.enabledTools }),
    },
  })
  return NextResponse.json({ agent }, { status: 201 })
}
