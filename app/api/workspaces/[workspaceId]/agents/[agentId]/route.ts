import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn } from '@/lib/migration-error'
import { resolveLocationForProvider, type RequestedProvider } from '@/lib/crm/resolve-location'
import { parseVocabularyRules } from '@/lib/agent/vocabulary'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const agent: any = await db.agent.findUnique({
    where: { id: agentId },
    include: {
      routingRules: { orderBy: { priority: 'asc' } },
      // Expose the Location's crmProvider on the agent payload so the
      // per-agent CRM picker can show the current selection without a
      // second round-trip. The id prefix ('native:', 'placeholder:') is
      // load-bearing for the factory but the UI just needs the provider.
      location: { select: { id: true, crmProvider: true } },
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

  // ─── CRM switch ────────────────────────────────────────────────────
  // body.crmProvider lets the per-agent CRM picker rebind this agent to
  // a different Location. Strict mode: we refuse to lazily create a
  // placeholder here, because the user explicitly picked a provider and
  // a silent fallback to a no-op adapter would surprise them. They need
  // to go connect the CRM at the workspace level first.
  let resolvedLocationId: string | null = null
  if (body.crmProvider !== undefined) {
    const requestedProvider = body.crmProvider as RequestedProvider
    const valid: RequestedProvider[] = ['native', 'ghl', 'hubspot']
    if (!valid.includes(requestedProvider)) {
      return NextResponse.json(
        { error: `Invalid crmProvider: ${body.crmProvider}` },
        { status: 400 },
      )
    }
    const loc = await resolveLocationForProvider({
      workspaceId,
      requestedProvider,
      strict: true,
    })
    if (!loc) {
      return NextResponse.json(
        {
          error: `No ${requestedProvider} CRM is connected to this workspace. Connect it from Integrations first.`,
          code: 'CRM_NOT_CONNECTED',
          requestedProvider,
        },
        { status: 400 },
      )
    }
    resolvedLocationId = loc.id
  }

  const judgeKeys = ['judgeEnabled', 'judgeModel', 'judgeAutoSend', 'judgeAutoBlock', 'judgeInstructions']
  const MODEL_KEYS = ['auto', 'claude-sonnet', 'claude-haiku', 'deepseek-flash', 'deepseek-pro']
  const buildData = (includeJudge: boolean, includeModel: boolean): Record<string, unknown> => ({
      ...(resolvedLocationId !== null && { locationId: resolvedLocationId }),
      ...(body.name !== undefined && { name: body.name }),
      ...(body.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
      ...(body.instructions !== undefined && { instructions: body.instructions }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.enabledTools !== undefined && { enabledTools: body.enabledTools }),
      ...(body.calendarId !== undefined && { calendarId: body.calendarId }),
      // folderId is nullable. We accept null explicitly so the agents
      // list "Move to: No folder" action works — `=== undefined` keeps
      // unrelated PATCH calls from clobbering an existing folder
      // assignment.
      ...(body.folderId !== undefined && { folderId: body.folderId === null ? null : String(body.folderId) }),
      ...(body.addToWorkflowsPick !== undefined && { addToWorkflowsPick: body.addToWorkflowsPick }),
      ...(body.removeFromWorkflowsPick !== undefined && { removeFromWorkflowsPick: body.removeFromWorkflowsPick }),
      ...(body.agentPersonaName !== undefined && { agentPersonaName: body.agentPersonaName }),
      ...(body.responseLength !== undefined && { responseLength: body.responseLength }),
      ...(body.formalityLevel !== undefined && { formalityLevel: body.formalityLevel }),
      ...(body.useEmojis !== undefined && { useEmojis: body.useEmojis }),
      ...(body.neverSayList !== undefined && { neverSayList: body.neverSayList }),
      // Vocabulary rules are validated/normalised server-side so the
      // runtime never has to defend against malformed rows. Send [] to
      // clear. (lib/agent/vocabulary.ts is the single parser.)
      ...(body.vocabularyRules !== undefined && { vocabularyRules: parseVocabularyRules(body.vocabularyRules) as any }),
      ...(body.simulateTypos !== undefined && { simulateTypos: body.simulateTypos }),
      ...(body.typingDelayEnabled !== undefined && { typingDelayEnabled: body.typingDelayEnabled }),
      ...(body.typingDelayMinMs !== undefined && { typingDelayMinMs: body.typingDelayMinMs }),
      ...(body.typingDelayMaxMs !== undefined && { typingDelayMaxMs: body.typingDelayMaxMs }),
      ...(body.languages !== undefined && { languages: body.languages }),
      ...(body.enableQuietCheckIn !== undefined && { enableQuietCheckIn: body.enableQuietCheckIn }),
      ...(Array.isArray(body.knowledgeDomainIds) && {
        knowledgeDomainIds: body.knowledgeDomainIds.filter((s: unknown) => typeof s === 'string'),
      }),
      ...(body.knowledgeScopeAll !== undefined && { knowledgeScopeAll: !!body.knowledgeScopeAll }),
      ...(body.qualifyingStyle !== undefined && { qualifyingStyle: body.qualifyingStyle }),
      ...(body.agentKind !== undefined && { agentKind: body.agentKind === 'procedural' ? 'procedural' : 'reactive' }),
      ...(body.procedureMode !== undefined && { procedureMode: body.procedureMode === 'advanced' ? 'advanced' : 'simple' }),
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
      // viewMode toggles the entire agent shell between the legacy tabbed
      // IA ('simple') and the visual workflow canvas ('advanced'). Only
      // accept the two known values — anything else is ignored rather than
      // erroring so older clients can keep PATCHing other fields safely.
      ...(typeof body.viewMode === 'string' && (body.viewMode === 'simple' || body.viewMode === 'advanced') && {
        viewMode: body.viewMode,
      }),
      // Which LLM serves this agent (lib/llm registry key). Gated like the
      // judge config so a DB without the `model` column degrades gracefully.
      ...(includeModel && typeof body.model === 'string' && {
        model: MODEL_KEYS.includes(body.model) ? body.model : 'auto',
      }),
  })

  // Validate every referenced CRM resource immediately so the UI can show
  // any broken references inline. Don't block the save — even if a reference
  // is broken, the user may have changed an unrelated field and we don't want
  // to lose their work.
  async function loadReferenceHealth(): Promise<Array<{
    resourceType: string
    resourceId: string
    status: string
    lastError: string | null
  }>> {
    try {
      const { runReferenceHealthCheck } = await import('@/lib/agent/reference-health/check')
      await runReferenceHealthCheck(agentId, { throttleMinutes: 0 })
      return await db.agentReferenceHealth.findMany({
        where: { agentId },
        select: { resourceType: true, resourceId: true, status: true, lastError: true },
      })
    } catch (err: any) {
      console.warn(`[agent PATCH] reference health check failed for ${agentId}:`, err?.message)
      return []
    }
  }

  // Try once with judge fields. If those columns are missing, retry
  // without them so the rest of the PATCH still goes through and the UI
  // gets clear signal that the AI Judge migration is pending.
  const wantsJudge = judgeKeys.some(k => body[k] !== undefined)
  const wantsModel = body.model !== undefined
  try {
    const agent = await db.agent.update({ where: { id: agentId }, data: buildData(true, true) as any })
    const referenceHealth = await loadReferenceHealth()
    return NextResponse.json({ agent, referenceHealth })
  } catch (err: any) {
    if (isMissingColumn(err) && (wantsJudge || wantsModel)) {
      try {
        const agent = await db.agent.update({ where: { id: agentId }, data: buildData(false, false) as any })
        const referenceHealth = await loadReferenceHealth()
        return NextResponse.json({
          agent,
          referenceHealth,
          warning: 'Some optional fields (AI Judge / model selection) were skipped — a column migration is pending.',
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

  // Best-effort: delete the registered Vapi assistant before the DB
  // cascade nukes the VapiConfig row. We swallow errors here — a
  // failed cleanup shouldn't block the agent delete.
  try {
    const { tearDownVapiAssistant } = await import('@/lib/voice/vapi-assistant')
    await tearDownVapiAssistant(agentId)
  } catch (err: any) {
    console.warn(`[Agent DELETE] Vapi teardown failed for ${agentId}:`, err?.message)
  }

  await db.agent.delete({ where: { id: agentId } })
  return NextResponse.json({ success: true })
}
