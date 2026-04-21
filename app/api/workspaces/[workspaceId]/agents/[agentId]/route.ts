import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
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
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
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
      ...(body.addToWorkflowsPick !== undefined && { addToWorkflowsPick: body.addToWorkflowsPick }),
      ...(body.removeFromWorkflowsPick !== undefined && { removeFromWorkflowsPick: body.removeFromWorkflowsPick }),
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
      ...(body.workingHoursEnabled !== undefined && { workingHoursEnabled: body.workingHoursEnabled }),
      ...(body.workingHoursStart !== undefined && { workingHoursStart: body.workingHoursStart }),
      ...(body.workingHoursEnd !== undefined && { workingHoursEnd: body.workingHoursEnd }),
      ...(body.workingDays !== undefined && { workingDays: body.workingDays }),
      ...(body.timezone !== undefined && { timezone: body.timezone }),
      ...(body.isPaused !== undefined && { isPaused: body.isPaused, pausedAt: body.isPaused ? new Date() : null }),
      ...(body.requireApproval !== undefined && { requireApproval: body.requireApproval }),
      ...(body.approvalRules !== undefined && { approvalRules: body.approvalRules }),
      // Advanced-context agent profile — only two values accepted; an
      // unexpected value is coerced to SIMPLE rather than rejected so we
      // don't hard-fail existing clients that don't know about the flag.
      ...(body.agentType !== undefined && {
        agentType: body.agentType === 'ADVANCED' ? 'ADVANCED' : 'SIMPLE',
      }),
      ...(body.businessContext !== undefined && {
        businessContext: typeof body.businessContext === 'string'
          ? body.businessContext.trim() || null
          : null,
      }),
    },
  })
  return NextResponse.json({ agent })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await db.agent.delete({ where: { id: agentId } })
  return NextResponse.json({ success: true })
}
