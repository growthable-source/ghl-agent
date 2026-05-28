import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { canCreateAgent, isTrialExpired, getPlanFeatures, recommendPlanForLimit, PLAN_FEATURES } from '@/lib/plans'
import { isInternalWorkspace } from '@/lib/internal-workspace'
import { resolveLocationForProvider, type RequestedProvider } from '@/lib/crm/resolve-location'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agents = await db.agent.findMany({
    where: { workspaceId },
    include: {
      // The agent card surfaces the number of *collections* this agent
      // pulls from. Each collection is a bundle of entries + data
      // sources, so collection-count is the meaningful unit now.
      _count: { select: { attachedCollections: true, routingRules: true, messageLogs: true, conversationStates: true } },
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
  // Plan is account-level (the workspace owner's best plan across all
  // their owned workspaces) — see lib/effective-plan.ts for why we don't
  // read the local workspace.plan directly.
  let effective: Awaited<ReturnType<typeof import('@/lib/effective-plan').getEffectivePlan>> | null = null
  try {
    const { getEffectivePlan } = await import('@/lib/effective-plan')
    effective = await getEffectivePlan(workspaceId)
  } catch {
    console.warn('[Agents] Feature gating query failed (migration pending?) — allowing agent creation')
  }

  // Internal workspaces (at least one @voxility.ai member, or allowlisted
  // via SUPER_ADMIN_EMAILS) skip every billing/trial gate. Staff, demo
  // accounts, and dogfooding shouldn't ever be blocked behind a paywall.
  const internal = await isInternalWorkspace(workspaceId)

  if (effective && !internal) {
    // Block expired trials — but only if the *owner has no paid plan
    // anywhere*. As soon as one of their workspaces is on Scale/Growth/
    // Starter, every workspace they own inherits those benefits.
    if (effective.trialExpired) {
      const recommendedPlan = recommendPlanForLimit('trial', 'TRIAL_EXPIRED')
      const recommendedFeatures = recommendedPlan ? PLAN_FEATURES[recommendedPlan] : null
      return NextResponse.json({
        error: 'Your trial has expired.',
        code: 'TRIAL_EXPIRED',
        currentPlan: effective.plan,
        recommendedPlan,
        recommendedPlanLabel: recommendedFeatures?.label ?? null,
        recommendedPlanPrice: recommendedFeatures?.monthlyPrice ?? null,
        benefit: 'Keep your agents running',
      }, { status: 403 })
    }

    const currentAgentCount = await db.agent.count({ where: { workspaceId } })
    if (!canCreateAgent(effective.plan, currentAgentCount, effective.extraAgentCount ?? 0)) {
      const recommendedPlan = recommendPlanForLimit(effective.plan, 'AGENT_LIMIT')
      const recommendedFeatures = recommendedPlan ? PLAN_FEATURES[recommendedPlan] : null
      return NextResponse.json({
        error: `Agent limit reached (${currentAgentCount}/${effective.agentLimit}).`,
        code: 'AGENT_LIMIT',
        currentPlan: effective.plan,
        currentCount: currentAgentCount,
        currentLimit: effective.agentLimit,
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
    // Resolve the new agent's locationId. body.crmProvider is the
    // wizard's CRM pick ('native' | 'ghl' | 'hubspot'); when missing we
    // fall through to the workspace's most-recent install. Lazy
    // placeholder creation when the workspace has no Location at all is
    // handled inside the helper so PATCH (strict mode) can share the
    // lookup without inheriting that behaviour.
    const requestedProvider = body.crmProvider as RequestedProvider
    const location = await resolveLocationForProvider({
      workspaceId,
      requestedProvider,
      strict: false,
    })
    if (!location) {
      // resolveLocationForProvider only returns null in strict mode; this
      // is defensive in case the helper signature drifts.
      return NextResponse.json({ error: 'Could not resolve a Location for this agent' }, { status: 500 })
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
        ...(Array.isArray(body.knowledgeDomainIds) && {
          knowledgeDomainIds: body.knowledgeDomainIds.filter((s: unknown) => typeof s === 'string'),
        }),
        agentType,
        businessContext,
      },
    })

    // If the caller picked a preset, apply it server-side AFTER agent
    // creation. Failure here doesn't block the agent — the agent still
    // exists with catalog defaults and the user can re-apply via the UI.
    if (typeof body.presetId === 'string' && body.presetId.length > 0) {
      try {
        const { applyPreset } = await import('@/lib/agent/presets')
        const applied = await applyPreset(agent.id, body.presetId)
        if (!applied) {
          console.warn(`[Agents] Unknown presetId "${body.presetId}" — agent created without preset config`)
        }
      } catch (err: any) {
        console.warn(`[Agents] Preset application failed for ${agent.id}: ${err?.message}`)
      }
    }

    return NextResponse.json({ agent }, { status: 201 })
  } catch (err: any) {
    console.error('[Agents] Failed to create agent:', err.message)
    return NextResponse.json({ error: err.message || 'Failed to create agent' }, { status: 500 })
  }
}
