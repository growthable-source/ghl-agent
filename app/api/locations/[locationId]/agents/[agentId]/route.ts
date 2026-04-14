import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
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
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const agent = await db.agent.update({
    where: { id: agentId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
      ...(body.instructions !== undefined && { instructions: body.instructions }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.enabledTools !== undefined && { enabledTools: body.enabledTools }),
      ...(body.calendarId !== undefined && { calendarId: body.calendarId }),
      ...(body.agentPersonaName !== undefined && { agentPersonaName: body.agentPersonaName }),
      ...(body.responseLength !== undefined && { responseLength: body.responseLength }),
      ...(body.formalityLevel !== undefined && { formalityLevel: body.formalityLevel }),
      ...(body.useEmojis !== undefined && { useEmojis: body.useEmojis }),
      ...(body.neverSayList !== undefined && { neverSayList: body.neverSayList }),
      ...(body.simulateTypos !== undefined && { simulateTypos: body.simulateTypos }),
      ...(body.typingDelayEnabled !== undefined && { typingDelayEnabled: body.typingDelayEnabled }),
      ...(body.typingDelayMinMs !== undefined && { typingDelayMinMs: body.typingDelayMinMs }),
      ...(body.typingDelayMaxMs !== undefined && { typingDelayMaxMs: body.typingDelayMaxMs }),
      ...(body.languages !== undefined && { languages: body.languages }),
      ...(body.qualifyingStyle !== undefined && { qualifyingStyle: body.qualifyingStyle }),
      ...(body.fallbackBehavior !== undefined && { fallbackBehavior: body.fallbackBehavior }),
      ...(body.fallbackMessage !== undefined && { fallbackMessage: body.fallbackMessage }),
    },
  })
  return NextResponse.json({ agent })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  await db.agent.delete({ where: { id: agentId } })
  return NextResponse.json({ success: true })
}
