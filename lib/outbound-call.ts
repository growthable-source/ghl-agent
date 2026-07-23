import { db } from '@/lib/db'
import { createOutboundCall } from '@/lib/vapi-client'
import { checkVoiceQuota } from '@/lib/voice-quota'

/**
 * Thrown when a workspace can't start a new voice call because it's
 * over its plan's included voice minutes (or voice isn't on the plan
 * at all). The route handler catches this and surfaces a brand-neutral
 * 402 with the typed code so the UI can render the "upgrade your plan"
 * card.
 */
export class VoiceQuotaError extends Error {
  constructor(
    public code: 'VOICE_QUOTA_EXCEEDED' | 'VOICE_NOT_ON_PLAN',
    public userMessage: string,
    public used: number,
    public limit: number,
    public planLabel: string,
  ) {
    super(userMessage)
    this.name = 'VoiceQuotaError'
  }
}

interface OutboundCallOpts {
  locationId: string
  agentId?: string
  contactId: string
  contactPhone: string
  contactName?: string
  triggerSource: 'ghl_workflow' | 'manual' | 'trigger'
  customInstructions?: string
}

interface OutboundCallResult {
  callLogId: string
  vapiCallId: string
}

export async function initiateOutboundCall(opts: OutboundCallOpts): Promise<OutboundCallResult> {
  const { locationId, contactId, contactPhone, contactName, triggerSource, customInstructions } = opts

  // 1. Resolve agent + voice config
  let vapiConfig: any
  if (opts.agentId) {
    vapiConfig = await db.vapiConfig.findFirst({
      where: { agentId: opts.agentId, isActive: true, phoneNumberId: { not: null } },
      include: { agent: true },
    })
  }
  if (!vapiConfig) {
    // Fallback: first voice-enabled agent for this location
    vapiConfig = await db.vapiConfig.findFirst({
      where: { agent: { locationId, isActive: true }, isActive: true, phoneNumberId: { not: null } },
      include: { agent: true },
    })
  }
  if (!vapiConfig || !vapiConfig.phoneNumberId) {
    throw new Error('No voice-enabled agent found for this location')
  }

  const agent = vapiConfig.agent
  const agentId = agent.id

  // 1a. Voice-minute quota check. Block the dial if the workspace has
  // used its included minutes — surfaces a brand-neutral "upgrade your
  // plan" message via the typed VoiceQuotaError. Calls in progress are
  // never affected; this gates new-call starts only.
  const quota = await checkVoiceQuota(agent.workspaceId)
  if (!quota.ok) {
    throw new VoiceQuotaError(
      quota.code,
      quota.message,
      quota.used,
      quota.limit,
      quota.planLabel,
    )
  }

  // 2. Duplicate check — skip if call to same number initiated in last 5 minutes
  const recentCall = await db.callLog.findFirst({
    where: {
      locationId,
      contactPhone,
      direction: 'outbound',
      status: 'initiated',
      createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) },
    },
  })
  if (recentCall) {
    throw new Error('An outbound call to this number was already initiated recently')
  }

  // 3. Per-call context for the registered assistant's {{callContext}}
  //    prompt slot. This is where the call's PURPOSE travels — the
  //    workflow's custom instructions used to be baked into a full
  //    inline assistant config that was built and then never sent
  //    (dead code since the registered-assistant migration), so every
  //    outbound call ran context-blind on the inbound-flavoured prompt.
  const callContextParts = [
    `This is an OUTBOUND call — you called ${contactName ? `${contactName} at ${contactPhone}` : contactPhone}. They did not call you.`,
    `Reason the call was placed: ${triggerSource === 'ghl_workflow' ? 'an automated workflow' : triggerSource === 'trigger' ? 'an automated trigger' : 'manually initiated by the business'}.`,
  ]
  if (customInstructions) {
    callContextParts.push(`Instructions for this call: ${customInstructions}`)
  }
  const callContext = callContextParts.join('\n')

  // Outbound-specific greeting. The registered assistant's firstMessage
  // is written for inbound ("how can I help you today?") which sounds
  // absurd on a call the agent placed.
  const firstMessage = contactName
    ? `Hi ${contactName}, this is ${agent.agentPersonaName || agent.name}. How are you doing today?`
    : `Hi there, this is ${agent.agentPersonaName || agent.name}. How are you doing today?`

  // 4. Create CallLog with status 'initiated'
  const callLog = await db.callLog.create({
    data: {
      locationId,
      agentId,
      contactId,
      contactPhone,
      direction: 'outbound',
      status: 'initiated',
      triggerSource,
    },
  })

  // 5. Resolve the registered Vapi assistant id for this agent.
  //    Lazy-backfill: agents created before this column existed get
  //    their assistant registered on first call. New agents already
  //    have it from agent-create. After this resolves we ALWAYS
  //    reference by id (never inline assistant config) — Vapi's
  //    registered assistant is the single source of truth.
  let assistantId: string
  try {
    const { ensureVapiAssistant } = await import('./voice/vapi-assistant')
    assistantId = await ensureVapiAssistant(agentId)
  } catch (err: any) {
    await db.callLog.update({
      where: { id: callLog.id },
      data: { status: 'failed', endedReason: `vapi_assistant_register_failed: ${err?.message ?? 'unknown'}` },
    })
    throw err
  }

  // 6. Call Vapi to initiate outbound call. We pass assistantId, not
  //    inline assistant config — the registered assistant has the
  //    voice block, model, tools, and server.url already validated
  //    by Vapi at registration time. Per-call context rides the
  //    overrides: callContext fills the prompt's {{callContext}} slot,
  //    firstMessage replaces the inbound-flavoured opener.
  try {
    const vapiResult = await createOutboundCall({
      phoneNumberId: vapiConfig.phoneNumberId!,
      customerNumber: contactPhone,
      assistantId,
      assistantOverrides: {
        variableValues: {
          locationId,
          workspaceId: agent.workspaceId,
          agentId,
          callerPhone: contactPhone,
          direction: 'outbound',
          callContext,
        },
        firstMessage,
      },
    })

    // 7. Update CallLog with Vapi call ID
    await db.callLog.update({
      where: { id: callLog.id },
      data: { vapiCallId: vapiResult.id },
    })

    return { callLogId: callLog.id, vapiCallId: vapiResult.id }
  } catch (err) {
    // Mark call as failed if Vapi rejects
    await db.callLog.update({
      where: { id: callLog.id },
      data: { status: 'failed', endedReason: err instanceof Error ? err.message : 'vapi_error' },
    })
    throw err
  }
}
