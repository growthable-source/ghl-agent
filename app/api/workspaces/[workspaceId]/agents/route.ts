import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { canCreateAgent, isTrialExpired, getPlanFeatures, recommendPlanForLimit, PLAN_FEATURES } from '@/lib/plans'
import { isInternalWorkspace } from '@/lib/internal-workspace'
import { resolveLocationForProvider, type RequestedProvider } from '@/lib/crm/resolve-location'
import { defaultAgentName } from '@/lib/random-name'
import { listCrmConnections } from '@/lib/workspace-crm-connections'

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

  // Per-agent connection identity — joins each agent's Location to its
  // MarketplaceInstall snapshot so the card can render "Connected to
  // <BusinessName>" instead of an opaque locationId. Native/placeholder
  // locations are filtered out by listCrmConnections, so agents on a
  // native CRM yield null here and the UI shows "Native CRM" instead.
  let connectionByLocation: Map<string, { businessName: string | null; provider: string }> = new Map()
  try {
    const conns = await listCrmConnections(workspaceId)
    connectionByLocation = new Map(
      conns.map(c => [c.locationId, { businessName: c.businessName, provider: c.provider }]),
    )
  } catch (err: any) {
    console.warn('[Agents] CRM connection identity lookup failed:', err?.message)
  }

  // Inline nextActions + connection onto each agent for the UI. The
  // connection field is null when the agent runs on a native:/placeholder:
  // location — the card surfaces that as "Native CRM" instead of a
  // sub-account name, which is the right read for those workspaces.
  const agentsWithNextActions = agents.map(a => {
    const conn = connectionByLocation.get(a.locationId) ?? null
    const isNative = a.locationId.startsWith('native:')
    const isPlaceholder = a.locationId.startsWith('placeholder:')
    return {
      ...a,
      nextActions: nextActionsByAgent[a.id] ?? { count: 0, nextAt: null },
      connection: {
        locationId: a.locationId,
        // Resolved name for the card. Falls back to a generic provider
        // label when there's no MarketplaceInstall snapshot yet (pre-
        // backfill installs) or when the location is native/placeholder.
        businessName: conn?.businessName ?? null,
        provider: isNative ? 'native' : isPlaceholder ? 'none' : (conn?.provider ?? 'ghl'),
      },
    }
  })

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

  // Internal workspaces (at least one @xovera.io member, or allowlisted
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

    // agentType enum:
    //   SIMPLE   — default text agent
    //   ADVANCED — text agent + extra hydration (opportunities, customFields,
    //              businessContext glossary) into every turn's system prompt
    //   VOICE    — voice-first agent. Channels skip the SMS/Email/etc step;
    //              the dashboard renders a different tab strip; the 'voice'
    //              preset disables text-channel send tools automatically.
    // Unknown values fall back to SIMPLE so legacy callers stay safe.
    const agentType =
      body.agentType === 'ADVANCED' ? 'ADVANCED'
      : body.agentType === 'VOICE' ? 'VOICE'
      : 'SIMPLE'
    const businessContext = typeof body.businessContext === 'string'
      ? body.businessContext.trim() || null
      : null

    // Voice agents get the 'voice' preset applied automatically (unless
    // the caller passed a different presetId, in which case the explicit
    // choice wins). Keeps the wizard from having to wire preset logic
    // separately — POST /agents creates a fully-configured voice agent.
    const effectivePresetId: string | null =
      typeof body.presetId === 'string' && body.presetId.length > 0
        ? body.presetId
        : agentType === 'VOICE' ? 'voice' : null

    // Calendar wiring at create time. The wizard sends `calendarId` when
    // the user picked a specific calendar in the LeadConnector calendar
    // step. Storing it here means the agent ships ready-to-book — no
    // separate trip through /tools to wire up the calendar later.
    const calendarId = typeof body.calendarId === 'string' && body.calendarId.length > 0
      ? body.calendarId
      : null

    // Voice agents must ship with the voice tool subset enabled so booking
    // + contact capture surface out of the box — the runtime exposes
    // VOICE_AGENT_TOOL_NAMES ∩ enabledTools, and the wizard doesn't send
    // enabledTools. Merge the subset into whatever was supplied (or seed it)
    // for VOICE agents; TEXT agents keep body.enabledTools ?? Prisma default.
    let effectiveEnabledTools: string[] | undefined =
      Array.isArray(body.enabledTools) ? body.enabledTools : undefined
    if (agentType === 'VOICE') {
      const { VOICE_AGENT_TOOL_NAMES } = await import('@/lib/agent/tool-catalog')
      const base = effectiveEnabledTools ?? ['get_contact_details', 'update_contact_tags']
      effectiveEnabledTools = [...new Set([...base, ...VOICE_AGENT_TOOL_NAMES])]
    }

    const agent = await db.agent.create({
      data: {
        workspaceId,
        locationId: location.id,
        // Default to a friendly "Curious Llama"-style name when the caller
        // doesn't supply one. The wizard sends a name (also random — see
        // app/dashboard/[workspaceId]/agents/new/page.tsx), but other
        // callers (test scripts, future API integrations) may not, and a
        // blank name violates the NOT NULL constraint and reads as a bug.
        name: defaultAgentName(body.name),
        systemPrompt: body.systemPrompt,
        instructions: body.instructions ?? null,
        ...(effectiveEnabledTools !== undefined && { enabledTools: effectiveEnabledTools }),
        ...(Array.isArray(body.knowledgeDomainIds) && {
          knowledgeDomainIds: body.knowledgeDomainIds.filter((s: unknown) => typeof s === 'string'),
        }),
        ...(calendarId && { calendarId }),
        agentType,
        businessContext,
      },
    })

    // Apply preset server-side AFTER agent creation. Voice agents get
    // the 'voice' preset by default (effectivePresetId resolved above);
    // text agents only get a preset when the caller explicitly passes one.
    // Failure here doesn't block agent creation — the agent still exists
    // with catalog defaults and the user can re-apply via the UI.
    if (effectivePresetId) {
      try {
        const { applyPreset } = await import('@/lib/agent/presets')
        const applied = await applyPreset(agent.id, effectivePresetId)
        if (!applied) {
          console.warn(`[Agents] Unknown presetId "${effectivePresetId}" — agent created without preset config`)
        }
      } catch (err: any) {
        console.warn(`[Agents] Preset application failed for ${agent.id}: ${err?.message}`)
      }
    }

    // Voice agents may ship with an initial VapiConfig (from the voice
    // wizard's voice + phone-number steps). Wrapped in try/catch so a
    // schema mismatch — e.g. a brand-new field added to VapiConfig that
    // the wizard sends but prod hasn't migrated — doesn't roll back the
    // whole agent create. The user can re-save voice config from the
    // Voice tab if this fails.
    // Track any Vapi-registration error so we can surface it back to the
    // wizard without rolling back the agent. The agent + VapiConfig stay
    // in DB; the user can retry registration from the Voice tab (or via
    // the wizard's "Retry" affordance on the final step).
    let vapiAssistantId: string | null = null
    let vapiSyncError: { message: string; code?: string } | null = null

    if (agentType === 'VOICE' && body.vapiConfig && typeof body.vapiConfig === 'object') {
      try {
        const v = body.vapiConfig as Record<string, unknown>
        await db.vapiConfig.create({
          data: {
            agentId: agent.id,
            isActive: v.isActive !== false,  // default on for voice agents
            ttsProvider: typeof v.ttsProvider === 'string' ? v.ttsProvider : 'vapi',
            voiceId: typeof v.voiceId === 'string' ? v.voiceId : '',
            voiceName: typeof v.voiceName === 'string' ? v.voiceName : null,
            phoneNumberId: typeof v.phoneNumberId === 'string' ? v.phoneNumberId : null,
            phoneNumber: typeof v.phoneNumber === 'string' ? v.phoneNumber : null,
            firstMessage: typeof v.firstMessage === 'string' ? v.firstMessage : null,
            endCallMessage: typeof v.endCallMessage === 'string' ? v.endCallMessage : null,
            language: typeof v.language === 'string' ? v.language : null,
            maxDurationSecs: typeof v.maxDurationSecs === 'number' ? v.maxDurationSecs : 600,
            recordCalls: v.recordCalls !== false,
            backgroundSound: typeof v.backgroundSound === 'string' ? v.backgroundSound : null,
            ...(typeof v.stability === 'number' && { stability: v.stability }),
            ...(typeof v.similarityBoost === 'number' && { similarityBoost: v.similarityBoost }),
            ...(typeof v.speed === 'number' && { speed: v.speed }),
            ...(typeof v.style === 'number' && { style: v.style }),
          } as any,
        })

        // Register the assistant on Vapi so phone + browser calls can
        // reference it by id (eliminating the "Meeting ended due to
        // ejection" class of bug from inline transient assistants).
        // Failure here is captured but doesn't roll back agent +
        // VapiConfig; user retries from the wizard's final step.
        try {
          const { ensureVapiAssistant } = await import('@/lib/voice/vapi-assistant')
          const { VapiError } = await import('@/lib/vapi-client')
          try {
            vapiAssistantId = await ensureVapiAssistant(agent.id)
          } catch (err: any) {
            if (err instanceof VapiError) {
              vapiSyncError = { message: err.userMessage, code: err.code }
            } else {
              vapiSyncError = { message: err?.message ?? 'Vapi registration failed' }
            }
            console.warn(`[Agents] Vapi assistant registration failed for ${agent.id}:`, vapiSyncError.message)
          }
        } catch (err: any) {
          console.warn(`[Agents] Vapi assistant module load failed for ${agent.id}:`, err?.message)
        }
      } catch (err: any) {
        console.warn(`[Agents] VapiConfig create failed for ${agent.id}: ${err?.message}`)
      }
    } else if (agentType === 'VOICE' && body.geminiVoiceConfig && typeof body.geminiVoiceConfig === 'object') {
      try {
        const g = body.geminiVoiceConfig as Record<string, unknown>
        await db.geminiVoiceConfig.create({
          data: {
            agentId: agent.id,
            isActive: g.isActive !== false,
            voiceName: typeof g.voiceName === 'string' ? g.voiceName : null,
            ...(typeof g.model === 'string' && g.model ? { model: g.model } : {}),
            firstMessage: typeof g.firstMessage === 'string' ? g.firstMessage : null,
            endCallMessage: typeof g.endCallMessage === 'string' ? g.endCallMessage : null,
            language: typeof g.language === 'string' ? g.language : null,
            ...(typeof g.twilioNumber === 'string' && { twilioNumber: g.twilioNumber }),
            ...(typeof g.twilioNumberSid === 'string' && { twilioNumberSid: g.twilioNumberSid }),
          },
        })
        // Flip the runtime discriminator so the dashboard + inbound phone
        // router treat this as a Gemini voice agent (not Vapi).
        await db.agent.update({ where: { id: agent.id }, data: { voiceRuntime: 'gemini' } })
      } catch (err: any) {
        console.warn(`[Agents] Gemini voice config create failed for ${agent.id}: ${err?.message}`)
      }
    }

    return NextResponse.json({ agent, vapiAssistantId, vapiSyncError }, { status: 201 })
  } catch (err: any) {
    console.error('[Agents] Failed to create agent:', err.message)
    return NextResponse.json({ error: err.message || 'Failed to create agent' }, { status: 500 })
  }
}
