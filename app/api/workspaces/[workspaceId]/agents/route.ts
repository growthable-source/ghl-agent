import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { canCreateAgent, isTrialExpired, getPlanFeatures, recommendPlanForLimit, PLAN_FEATURES } from '@/lib/plans'
import { isInternalWorkspace } from '@/lib/internal-workspace'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agents = await db.agent.findMany({
    where: { workspaceId },
    include: {
      _count: { select: { knowledgeEntries: true, routingRules: true, messageLogs: true, conversationStates: true } },
      channelDeployments: { where: { isActive: true }, select: { channel: true } },
      vapiConfig: { select: { isActive: true, phoneNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Aggregate next-action counts per agent from scheduled follow-up jobs
  const agentIds = agents.map(a => a.id)
  const nextActionsByAgent: Record<string, { count: number; nextAt: string | null }> = {}
  if (agentIds.length > 0) {
    try {
      const jobs = await db.followUpJob.findMany({
        where: {
          status: 'SCHEDULED',
          sequence: { agentId: { in: agentIds } },
        },
        select: {
          scheduledAt: true,
          sequence: { select: { agentId: true } },
        },
      })
      for (const job of jobs) {
        const aid = job.sequence.agentId
        if (!nextActionsByAgent[aid]) {
          nextActionsByAgent[aid] = { count: 0, nextAt: null }
        }
        nextActionsByAgent[aid].count++
        const ts = new Date(job.scheduledAt).toISOString()
        if (!nextActionsByAgent[aid].nextAt || ts < nextActionsByAgent[aid].nextAt!) {
          nextActionsByAgent[aid].nextAt = ts
        }
      }
    } catch (err: any) {
      console.warn('[Agents] Next actions aggregation failed:', err.message)
    }
  }

  // Inline nextActions onto each agent for the UI
  const agentsWithNextActions = agents.map(a => ({
    ...a,
    nextActions: nextActionsByAgent[a.id] ?? { count: 0, nextAt: null },
  }))

  // Get workspace plan info for agent limit display
  let planInfo: { plan: string; agentLimit: number; extraAgentCount: number } | null = null
  try {
    planInfo = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true, agentLimit: true, extraAgentCount: true },
    })
  } catch {
    // Billing columns may not exist yet
  }

  const features = planInfo ? getPlanFeatures(planInfo.plan) : null
  const maxAgents = features ? features.agents + (planInfo?.extraAgentCount ?? 0) : null

  return NextResponse.json({
    agents: agentsWithNextActions,
    meta: {
      total: agents.length,
      limit: maxAgents,
      plan: planInfo?.plan ?? 'trial',
    },
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // ─── Feature gating: check agent limit ───
  let workspace: { plan: string; agentLimit: number; extraAgentCount: number; trialEndsAt: Date | null } | null = null
  try {
    workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { plan: true, agentLimit: true, extraAgentCount: true, trialEndsAt: true },
    })
  } catch {
    // Columns may not exist yet if billing migration hasn't been run — skip gating
    console.warn('[Agents] Feature gating query failed (migration pending?) — allowing agent creation')
  }

  // Internal workspaces (at least one @voxility.ai member, or allowlisted
  // via SUPER_ADMIN_EMAILS) skip every billing/trial gate. Staff, demo
  // accounts, and dogfooding shouldn't ever be blocked behind a paywall.
  const internal = await isInternalWorkspace(workspaceId)

  if (workspace && !internal) {
    // Block expired trials
    if (workspace.plan === 'trial' && isTrialExpired(workspace.trialEndsAt)) {
      const recommendedPlan = recommendPlanForLimit('trial', 'TRIAL_EXPIRED')
      const recommendedFeatures = recommendedPlan ? PLAN_FEATURES[recommendedPlan] : null
      return NextResponse.json({
        error: 'Your trial has expired.',
        code: 'TRIAL_EXPIRED',
        currentPlan: workspace.plan,
        recommendedPlan,
        recommendedPlanLabel: recommendedFeatures?.label ?? null,
        recommendedPlanPrice: recommendedFeatures?.monthlyPrice ?? null,
        benefit: 'Keep your agents running',
      }, { status: 403 })
    }

    const currentAgentCount = await db.agent.count({ where: { workspaceId } })
    if (!canCreateAgent(workspace.plan, currentAgentCount, workspace.extraAgentCount ?? 0)) {
      const recommendedPlan = recommendPlanForLimit(workspace.plan, 'AGENT_LIMIT')
      const recommendedFeatures = recommendedPlan ? PLAN_FEATURES[recommendedPlan] : null
      return NextResponse.json({
        error: `Agent limit reached (${currentAgentCount}/${workspace.agentLimit}).`,
        code: 'AGENT_LIMIT',
        currentPlan: workspace.plan,
        currentCount: currentAgentCount,
        currentLimit: workspace.agentLimit,
        recommendedPlan,
        recommendedPlanLabel: recommendedFeatures?.label ?? null,
        recommendedPlanPrice: recommendedFeatures?.monthlyPrice ?? null,
        recommendedPlanCapacity: recommendedFeatures?.agents ?? null,
        benefit: recommendedFeatures ? `${recommendedFeatures.agents} agent slots` : null,
      }, { status: 403 })
    }
  }

  let body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    // Resolve the locationId the new agent FKs to. Three cases:
    //   1. Workspace has a real GHL Location (OAuth installed) → use it
    //   2. Workspace has a placeholder Location from a previous no-CRM
    //      agent create → reuse it
    //   3. No Location at all → create a placeholder. Placeholders exist
    //      purely as FK targets; they're flagged crmProvider='none' so the
    //      CRM factory routes them to a no-op adapter.
    // Previously this fell back to `locationId: workspaceId`, which
    // violated the Location FK because workspaceId isn't a Location.id —
    // that's the bug new users hit the first time they tried to create
    // an agent before connecting GHL.
    let location = await db.location.findFirst({
      where: { workspaceId },
      select: { id: true },
      // Prefer the most-recent install (real GHL location wins over any old placeholder)
      orderBy: { installedAt: 'desc' },
    })
    if (!location) {
      const placeholderId = `placeholder:${workspaceId}`
      location = await db.location.upsert({
        where: { id: placeholderId },
        create: {
          id: placeholderId,
          workspaceId,
          // OAuth fields are non-null in the schema but meaningless for a
          // placeholder — empty strings satisfy the constraint without
          // claiming any real credentials.
          companyId: '',
          userId: '',
          userType: '',
          scope: '',
          accessToken: '',
          refreshToken: '',
          refreshTokenId: '',
          expiresAt: new Date(0),
          crmProvider: 'none',
        },
        update: {},
        select: { id: true },
      })
    }

    // agentType is 'SIMPLE' by default (schema default). ADVANCED agents
    // also persist a businessContext glossary; the runAgent path checks
    // agentType to decide whether to fetch opportunities + hydrate custom
    // fields. Free-text businessContext is harmless on a SIMPLE agent —
    // upgrading later just flips the flag without a migration.
    const agentType = body.agentType === 'ADVANCED' ? 'ADVANCED' : 'SIMPLE'
    const businessContext = typeof body.businessContext === 'string'
      ? body.businessContext.trim() || null
      : null

    const agent = await db.agent.create({
      data: {
        workspaceId,
        locationId: location.id,
        name: body.name,
        systemPrompt: body.systemPrompt,
        instructions: body.instructions ?? null,
        ...(body.enabledTools !== undefined && { enabledTools: body.enabledTools }),
        agentType,
        businessContext,
      },
    })
    return NextResponse.json({ agent }, { status: 201 })
  } catch (err: any) {
    console.error('[Agents] Failed to create agent:', err.message)
    return NextResponse.json({ error: err.message || 'Failed to create agent' }, { status: 500 })
  }
}
