import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: {
      knowledgeEntries: { orderBy: { createdAt: 'asc' } },
      routingRules: { orderBy: { priority: 'asc' } },
    },
  })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ agent })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { agentId } = await params
  const body = await req.json()
  const agent = await db.agent.update({
    where: { id: agentId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
      ...(body.instructions !== undefined && { instructions: body.instructions }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  })
  return NextResponse.json({ agent })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { agentId } = await params
  await db.agent.delete({ where: { id: agentId } })
  return NextResponse.json({ success: true })
}
