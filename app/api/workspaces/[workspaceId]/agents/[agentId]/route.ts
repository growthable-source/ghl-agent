import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const agent: any = await db.agent.findUnique({
    where: { id: agentId },
    include: {
      routingRules: { orderBy: { priority: 'asc' } },
    },
  })
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Hydrate knowledge via the workspace junction. Some agent-detail
  // consumers still expect `knowledgeEntries` so we splice it onto the
  // returned agent in the same shape as before.
  const { bulkLoadKnowledgeForAgents } = await import('@/lib/knowledge')
  const map = await bulkLoadKnowledgeForAgents([agent.id])
  agent.knowledgeEntries = map.get(agent.id) ?? []
  return NextResponse.json({ agent })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const judgeKeys = ['judgeEnabled', 'judgeModel', 'judgeAutoSend', 'judgeAutoBlock', 'judgeInstructions']
  const buildData = (includeJudge: boolean): Record<string, unknown> => ({
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
      // AI Judge config — only included when includeJudge=true so the
      // PATCH degrades gracefully on a DB where manual_ai_judge.sql
      // hasn't run yet (we retry without these on P2022).
      ...(includeJudge && body.judgeEnabled !== undefined && { judgeEnabled: !!body.judgeEnabled }),
      ...(includeJudge && body.judgeModel !== undefined && { judgeModel: body.judgeModel === 'sonnet' ? 'sonnet' : 'haiku' }),
      ...(includeJudge && body.judgeAutoSend !== undefined && { judgeAutoSend: !!body.judgeAutoSend }),
      ...(includeJudge && body.judgeAutoBlock !== undefined && { judgeAutoBlock: !!body.judgeAutoBlock }),
      ...(includeJudge && body.judgeInstructions !== undefined && {
        judgeInstructions: typeof body.judgeInstructions === 'string'
          ? body.judgeInstructions.trim() || null
          : null,
      }),
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
  })

  // Try once with judge fields. If those columns are missing, retry
  // without them so the rest of the PATCH still goes through and the UI
  // gets clear signal that the AI Judge migration is pending.
  const wantsJudge = judgeKeys.some(k => body[k] !== undefined)
  try {
    const agent = await db.agent.update({ where: { id: agentId }, data: buildData(true) as any })
    return NextResponse.json({ agent })
  } catch (err: any) {
    if (isMissingColumn(err) && wantsJudge) {
      try {
        const agent = await db.agent.update({ where: { id: agentId }, data: buildData(false) as any })
        return NextResponse.json({
          agent,
          warning: 'Judge config skipped — run prisma/migrations-legacy/manual_ai_judge.sql to enable it.',
          code: 'JUDGE_MIGRATION_PENDING',
        })
      } catch (err2: any) {
        return NextResponse.json({ error: err2.message || 'Failed to update agent' }, { status: 500 })
      }
    }
    if (isMissingColumn(err)) {
      return NextResponse.json({
        error: 'Some agent columns are missing — check pending Prisma migrations.',
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    return NextResponse.json({ error: err.message || 'Failed to update agent' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  await db.agent.delete({ where: { id: agentId } })
  return NextResponse.json({ success: true })
}
