import { db } from '@/lib/db'
import { createOutboundCall } from '@/lib/vapi-client'
import { VAPI_TOOLS, buildVoiceSystemPrompt } from '@/lib/voice-prompt'
import { buildVapiVoiceBlock, resolveVoiceEngine } from '@/lib/voice/vapi-adapter'

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
  // Hydrate workspace-stacked knowledge via the junction (single source
  // of truth). Mutates the agent in place so downstream prompt-building
  // can read agent.knowledgeEntries unchanged.
  const { bulkLoadKnowledgeForAgents } = await import('./knowledge')
  const knMap = await bulkLoadKnowledgeForAgents([agent.id])
  agent.knowledgeEntries = knMap.get(agent.id) ?? []
  const agentId = agent.id

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

  // 3. Build system prompt with outbound context
  let systemPrompt = await buildVoiceSystemPrompt(
    agent,
    agent.knowledgeEntries,
    contactPhone,
    locationId,
    vapiConfig.voiceTools as any[],
    'outbound'
  )
  if (customInstructions) {
    systemPrompt += `\n\n## Workflow Instructions\n${customInstructions}`
  }

  // 4. Build assistant config (same shape as inbound assistant-request response)
  const assistantConfig = {
    name: agent.name,
    model: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'system', content: systemPrompt }],
      tools: [
        ...VAPI_TOOLS,
        ...((vapiConfig.voiceTools as any[]) || []).map(({ condition, ...rest }: any) => rest),
      ],
    },
    voice: buildVapiVoiceBlock({
      engine: resolveVoiceEngine(vapiConfig.ttsProvider),
      voiceId: vapiConfig.voiceId,
      stability: vapiConfig.stability,
      similarityBoost: vapiConfig.similarityBoost,
      speed: vapiConfig.speed,
      style: vapiConfig.style,
      language: vapiConfig.language,
    }),
    firstMessage: contactName
      ? `Hi ${contactName}, this is ${agent.agentPersonaName || agent.name}. How are you doing today?`
      : `Hi there, this is ${agent.agentPersonaName || agent.name}. How are you doing today?`,
    endCallMessage: vapiConfig.endCallMessage || 'Thanks for your time. Have a great day!',
    maxDurationSeconds: vapiConfig.maxDurationSecs,
    recordingEnabled: vapiConfig.recordCalls,
    ...(vapiConfig.backgroundSound ? { backgroundSound: vapiConfig.backgroundSound } : {}),
    ...(vapiConfig.endCallPhrases?.length ? { endCallPhrases: vapiConfig.endCallPhrases } : {}),
    serverUrl: `${process.env.APP_URL}/api/vapi/webhook`,
    serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET,
  }

  // 5. Create CallLog with status 'initiated'
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

  // 6. Resolve the registered Vapi assistant id for this agent.
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

  // 7. Call Vapi to initiate outbound call. We pass assistantId, not
  //    inline assistant config — the registered assistant has the
  //    voice block, model, tools, and server.url already validated
  //    by Vapi at registration time.
  try {
    const vapiResult = await createOutboundCall({
      phoneNumberId: vapiConfig.phoneNumberId!,
      customerNumber: contactPhone,
      assistantId,
      assistantOverrides: {
        variableValues: {
          locationId,
          agentId,
          callerPhone: contactPhone,
          direction: 'outbound',
        },
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
