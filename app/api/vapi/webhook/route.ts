import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildVoiceSystemPrompt } from '@/lib/voice-prompt'
import { buildVapiVoiceBlock, resolveVoiceEngine } from '@/lib/voice/vapi-adapter'

async function findAgentByPhoneNumber(phoneNumber: string) {
  const vapiConfig: any = await db.vapiConfig.findFirst({
    where: { phoneNumber, isActive: true },
    include: { agent: true },
  })
  if (vapiConfig?.agent) {
    // Hydrate workspace-stacked knowledge via the junction.
    const { bulkLoadKnowledgeForAgents } = await import('@/lib/knowledge')
    const map = await bulkLoadKnowledgeForAgents([vapiConfig.agent.id])
    vapiConfig.agent.knowledgeEntries = map.get(vapiConfig.agent.id) ?? []
  }
  return vapiConfig
}

/** Per-call context shared across every voice tool dispatch. */
interface VoiceToolContext {
  locationId: string
  agentId: string
  callerPhone: string
}

/**
 * Single dispatcher for every voice-side function tool. Returns a
 * string result that gets wrapped per event-shape by the caller —
 * either { result } for legacy function-call or
 * { results: [{ toolCallId, name, result }] } for the modern
 * tool-calls event (Round 15).
 *
 * Errors are caught and stringified so the model gets a coherent
 * response back instead of Vapi seeing "No result returned".
 */
// Hard ceiling on any single tool's execution. The caller is ON A
// LIVE PHONE CALL: Vapi blocks waiting for this webhook, and a CRM
// API that hangs (LeadConnector under load does) used to hang the
// whole call until Vapi's own ~30s timeout dropped it mid-sentence.
// Better to give the model an honest "couldn't reach the system"
// after 8s — it apologises and keeps the conversation alive.
const VOICE_TOOL_TIMEOUT_MS = 8000

async function runVoiceTool(
  functionName: string,
  params: Record<string, unknown>,
  ctx: VoiceToolContext,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string>(resolve => {
    timer = setTimeout(() => {
      console.warn(`[Voice tool] ${functionName} timed out after ${VOICE_TOOL_TIMEOUT_MS}ms`)
      resolve(
        'The system is taking too long to respond right now. Tell the caller you could not check that just now and offer to follow up — do not invent an answer.',
      )
    }, VOICE_TOOL_TIMEOUT_MS)
  })
  try {
    return await Promise.race([runVoiceToolInner(functionName, params, ctx), timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function runVoiceToolInner(
  functionName: string,
  params: Record<string, unknown>,
  ctx: VoiceToolContext,
): Promise<string> {
  console.log('[Voice tool] called:', {
    tool: functionName,
    agentId: ctx.agentId,
    paramsPreview: JSON.stringify(params).slice(0, 300),
  })

  const SHOPIFY_TOOL_NAMES = new Set([
    'search_shopify_products',
    'check_shopify_inventory',
    'lookup_shopify_customer',
    'check_shopify_order_status',
    'create_shopify_checkout',
    'create_shopify_discount',
    'record_back_in_stock_interest',
  ])

  try {
    // ── query_knowledge — vector retrieval over the workspace's
    // indexed content. THE primary voice tool for fact-grounding.
    if (functionName === 'query_knowledge') {
      if (!ctx.agentId) return 'No agent context — try again or contact support.'
      const agent = await db.agent.findUnique({
        where: { id: ctx.agentId },
        select: { workspaceId: true, knowledgeDomainIds: true },
      })
      if (!agent || !agent.workspaceId) return 'Agent not found or not assigned to a workspace.'
      const query: string = typeof params.query === 'string' ? params.query : ''
      if (!query.trim()) return 'No query provided — please ask again with a specific question.'
      const { retrieveAndFormatForAgent } = await import('@/lib/agent/retrieve-for-agent')
      const { block, chunks } = await retrieveAndFormatForAgent(
        { id: ctx.agentId, workspaceId: agent.workspaceId, knowledgeDomainIds: agent.knowledgeDomainIds },
        query,
      )
      console.log('[Voice tool] query_knowledge result:', {
        query,
        chunkCount: chunks.length,
        topTitle: chunks[0]?.sourceMetadata?.page_title ?? chunks[0]?.primaryTopic ?? null,
        topSimilarity: chunks[0]?.similarity ?? null,
      })
      if (!chunks || chunks.length === 0) {
        return 'No relevant information in the knowledge base. Tell the caller honestly and offer a follow-up.'
      }
      return block
    }

    // ── Shopify tools — delegate to the canonical text-agent executor
    // so we never duplicate the commerce adapter logic.
    if (SHOPIFY_TOOL_NAMES.has(functionName)) {
      if (!ctx.locationId) return 'Cannot reach the store right now.'
      if (!ctx.agentId) return 'No agent context for this call.'
      const agentForShopify = await db.agent.findUnique({
        where: { id: ctx.agentId },
        select: { workspaceId: true },
      })
      const workspaceIdForShopify = agentForShopify?.workspaceId
      if (!workspaceIdForShopify) return 'Could not resolve workspace for store lookup.'
      const { executeTool } = await import('@/lib/agent/execute-tool')
      const result = await executeTool(
        functionName,
        params,
        ctx.locationId,
        false,
        ctx.agentId,
        'voice',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        workspaceIdForShopify,
        undefined,
      )
      // Surface whether the executor reached the store or fell back to
      // shopify_not_connected. Result is a JSON string — log a preview
      // so we don't blow out log size on big product lists.
      console.log('[Voice tool] shopify result:', {
        tool: functionName,
        workspaceId: workspaceIdForShopify,
        preview: result.slice(0, 400),
      })
      return result
    }

    // ── CRM / calendar tools — delegate to the canonical executor via the
    // shared voice resolver. It resolves the caller's contact from
    // callerPhone (so booking defaults to "the caller"), injects the
    // agent's bound calendarId, and calls executeTool exactly like the
    // text agent does. The old hand-rolled switch (which failed booking
    // for unknown callers and had no contact-capture path) is gone.
    const agentRow = ctx.agentId
      ? await db.agent.findUnique({
          where: { id: ctx.agentId },
          select: { workspaceId: true, calendarId: true },
        })
      : null
    const { runVoiceAgentTool } = await import('@/lib/voice/voice-tool-context')
    return runVoiceAgentTool({
      name: functionName,
      params,
      agentId: ctx.agentId,
      locationId: ctx.locationId,
      workspaceId: agentRow?.workspaceId ?? null,
      callerPhone: ctx.callerPhone,
      calendarId: agentRow?.calendarId ?? null,
    })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn('[Voice tool] dispatch error:', { tool: functionName, errMsg })
    return `Error: ${errMsg}`
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const message = body.message || body

  const messageType = message.type

  // Unconditional top-level log — search Vercel logs for "[Vapi webhook]"
  // to confirm whether Vapi is hitting us AT ALL. If you don't see
  // this on a test call, the assistant's `server.url` is wrong
  // (APP_URL misconfigured at deploy time, or the assistant was
  // registered before APP_URL was correct and cached the wrong URL).
  // The fix in that case is to verify APP_URL and re-clear vapiAssistantId.
  console.log('[Vapi webhook] hit:', {
    type: messageType,
    callId: message?.call?.id || null,
    assistantId: message?.call?.assistantId || null,
  })

  // ── Assistant request — return agent config for this call ──
  if (messageType === 'assistant-request') {
    const call = message.call
    const callerPhone: string = call?.customer?.number || ''
    const toPhone: string = call?.phoneNumber?.number || ''

    const vapiConfig = await findAgentByPhoneNumber(toPhone)

    if (!vapiConfig) {
      return NextResponse.json({
        assistant: {
          model: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-20250514',
            messages: [{ role: 'system', content: 'You are a helpful assistant. This number is not configured yet.' }],
          },
          voice: { provider: 'elevenlabs', voiceId: 'EXAVITQu4vr4xnSDxMaL' },
          firstMessage: 'Hello! This line is not configured yet.',
        },
      })
    }

    const agent = vapiConfig.agent
    const locationId = agent.locationId
    const systemPrompt = await buildVoiceSystemPrompt(agent, agent.knowledgeEntries, callerPhone, locationId, vapiConfig.voiceTools as any[])

    // Catalogue-generated tool list (knowledge + voice subset ∩ enabledTools
    // + conditional Shopify + custom) — same set the registered-assistant
    // path uses. No hardcoded VAPI_TOOLS.
    const { buildVoiceFunctionTools } = await import('@/lib/voice/vapi-assistant')
    const voiceFunctionTools = await buildVoiceFunctionTools({
      agentId: agent.id,
      workspaceId: agent.workspaceId,
      enabledTools: (agent as any).enabledTools ?? [],
      customVoiceTools: (vapiConfig.voiceTools as any[]) || [],
    })

    // Resolve the caller to a contact so merge fields in first/end messages
    // can render. Inbound voice calls often come from unknown numbers — if
    // the lookup fails we pass null and fallback syntax kicks in.
    let voiceContact: any = null
    try {
      const { searchContacts } = await import('@/lib/crm-client')
      const matches = callerPhone ? await searchContacts(locationId, callerPhone) : []
      voiceContact = matches.find(c => c.phone === callerPhone) ?? matches[0] ?? null
    } catch { /* non-fatal */ }
    const { renderMergeFields, resolveAssignedUser, hydrateContactCustomFields } = await import('@/lib/merge-fields')
    // Resolve the contact's assigned team member + hydrate custom field
    // keys so {{user.*}} and {{custom.*}} tokens render in the voice
    // opener/closer. Both best-effort.
    let assignedUser: Awaited<ReturnType<typeof resolveAssignedUser>> = null
    let hydratedContact = voiceContact
    try {
      const { GhlAdapter } = await import('@/lib/crm/ghl/adapter')
      const adapter = new GhlAdapter(locationId)
      const [u, c] = await Promise.all([
        resolveAssignedUser(adapter, voiceContact),
        hydrateContactCustomFields(adapter, voiceContact),
      ])
      assignedUser = u
      hydratedContact = c ?? voiceContact
    } catch { /* non-fatal */ }
    const mergeCtx = {
      contact: hydratedContact,
      agent: { name: agent.agentPersonaName || agent.name },
      user: assignedUser,
      timezone: (agent as any).timezone ?? null,
    }

    return NextResponse.json({
      assistant: {
        name: agent.name,
        model: {
          provider: 'anthropic',
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'system', content: systemPrompt }],
          tools: voiceFunctionTools,
        },
        voice: buildVapiVoiceBlock({
          engine: resolveVoiceEngine(vapiConfig.ttsProvider),
          voiceId: vapiConfig.voiceId,
          stability: vapiConfig.stability,
          similarityBoost: vapiConfig.similarityBoost,
          speed: vapiConfig.speed,
          style: vapiConfig.style,
          language: vapiConfig.language,
        }) as any,
        firstMessage: renderMergeFields(
          vapiConfig.firstMessage || `Hi there! This is ${agent.agentPersonaName || agent.name}. How can I help you today?`,
          mergeCtx,
        ),
        endCallMessage: renderMergeFields(
          vapiConfig.endCallMessage || 'Thanks for calling. Have a great day!',
          mergeCtx,
        ),
        maxDurationSeconds: vapiConfig.maxDurationSecs,
        recordingEnabled: vapiConfig.recordCalls,
        ...(vapiConfig.backgroundSound ? { backgroundSound: vapiConfig.backgroundSound } : {}),
        ...(vapiConfig.endCallPhrases?.length ? { endCallPhrases: vapiConfig.endCallPhrases } : {}),
        serverUrl: `${process.env.APP_URL}/api/vapi/webhook`,
        serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET,
      },
      assistantOverrides: {
        variableValues: {
          locationId,
          agentId: agent.id,
          callerPhone,
        },
      },
    })
  }

  // ── Tool calls — the modern event shape (Round 14 onwards) ──
  //
  // When the assistant references tools via model.toolIds (standalone
  // Tool entities), Vapi fires `tool-calls` instead of the older
  // `function-call`. Shape difference:
  //   { type: 'tool-calls', toolCallList: [{ id, function: { name, arguments } }] }
  // Expected response:
  //   { results: [{ toolCallId, name, result }] }
  // Sending the old { result } shape causes "No result returned" in
  // Vapi's call log (Round 15 finding — burned 5 rounds chasing the
  // wrong layer).
  if (messageType === 'tool-calls') {
    const call = message.call
    const locationId: string = call?.assistantOverrides?.variableValues?.locationId || call?.metadata?.locationId
    const agentId: string = call?.assistantOverrides?.variableValues?.agentId
    const callerPhone: string = call?.assistantOverrides?.variableValues?.callerPhone || call?.customer?.number

    const toolCalls: Array<{ id: string; function?: { name?: string; arguments?: string | object } }> =
      Array.isArray(message.toolCallList) ? message.toolCallList : []

    console.log('[Vapi webhook] tool-calls:', {
      count: toolCalls.length,
      tools: toolCalls.map(tc => tc.function?.name),
    })

    const ctx = { locationId, agentId, callerPhone }
    const results = await Promise.all(toolCalls.map(async tc => {
      const name = tc.function?.name || ''
      // arguments is a JSON string per Vapi's ToolCallFunction.arguments
      // type — parse defensively because some clients send objects.
      let args: Record<string, unknown> = {}
      try {
        if (typeof tc.function?.arguments === 'string' && tc.function.arguments.trim()) {
          args = JSON.parse(tc.function.arguments)
        } else if (typeof tc.function?.arguments === 'object' && tc.function.arguments) {
          args = tc.function.arguments as Record<string, unknown>
        }
      } catch (err: any) {
        console.warn('[Vapi webhook] tool args parse failed:', err?.message)
      }
      const result = await runVoiceTool(name, args, ctx)
      return { toolCallId: tc.id, name, result }
    }))

    return NextResponse.json({ results })
  }

  // ── Function call — legacy event shape ──
  // Older event Vapi fires when the assistant uses inline model.tools[]
  // instead of toolIds. Kept for back-compat with any agent still
  // running an inline-tools assistant. Returns the singular { result }
  // shape that this event expects.
  if (messageType === 'function-call') {
    const call = message.call
    const functionCall = message.functionCall
    const functionName: string = functionCall?.name
    const params = functionCall?.parameters || {}

    const locationId: string = call?.assistantOverrides?.variableValues?.locationId || call?.metadata?.locationId
    const agentId: string = call?.assistantOverrides?.variableValues?.agentId
    const callerPhone: string = call?.assistantOverrides?.variableValues?.callerPhone || call?.customer?.number

    const result = await runVoiceTool(functionName, params, { locationId, agentId, callerPhone })
    return NextResponse.json({ result })
  }

  // ── End of call report — save transcript and call log ──
  if (messageType === 'end-of-call-report') {
    const call = message.call
    const transcript: string = message.transcript || ''
    const summary: string = message.summary || ''
    const recordingUrl: string = message.recordingUrl || ''
    const durationSecs = Math.round((call?.endedAt && call?.startedAt)
      ? (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
      : 0)

    const locationId: string = call?.assistantOverrides?.variableValues?.locationId
    const agentId: string = call?.assistantOverrides?.variableValues?.agentId
    const callerPhone: string = call?.assistantOverrides?.variableValues?.callerPhone || call?.customer?.number
    const direction: string = call?.assistantOverrides?.variableValues?.direction || 'inbound'

    if (locationId) {
      try {
        const callStatus = call?.endedReason === 'customer-ended-call' ? 'completed' : (call?.endedReason || 'completed')

        if (direction === 'outbound' && call?.id) {
          // Outbound calls have a pre-created CallLog — update it
          const existing = await db.callLog.findUnique({ where: { vapiCallId: call.id } })
          if (existing) {
            await db.callLog.update({
              where: { vapiCallId: call.id },
              data: { status: callStatus, durationSecs, transcript, summary, recordingUrl, endedReason: call?.endedReason },
            })
          } else {
            await db.callLog.create({
              data: {
                locationId, agentId: agentId || null, contactPhone: callerPhone,
                vapiCallId: call.id, direction: 'outbound', status: callStatus,
                durationSecs, transcript, summary, recordingUrl, endedReason: call?.endedReason,
              },
            })
          }
        } else {
          await db.callLog.create({
            data: {
              locationId, agentId: agentId || null, contactPhone: callerPhone,
              vapiCallId: call?.id, direction: 'inbound', status: callStatus,
              durationSecs, transcript, summary, recordingUrl, endedReason: call?.endedReason,
            },
          })
        }

        // Track voice usage for billing
        if (durationSecs > 0 && agentId) {
          try {
            const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } })
            if (agent?.workspaceId) {
              const { trackVoiceUsage } = await import('@/lib/usage')
              await trackVoiceUsage(agent.workspaceId, agentId, durationSecs)
            }
          } catch (usageErr) {
            console.error('[Vapi] Error tracking voice usage:', usageErr)
          }
        }

        if (summary && agentId && callerPhone) {
          try {
            const { searchContacts: sc4 } = await import('@/lib/crm-client')
            const contacts = await sc4(locationId, callerPhone)
            if (contacts && contacts.length > 0) {
              const contactId = contacts[0].id
              await db.contactMemory.upsert({
                where: { agentId_contactId: { agentId, contactId } },
                create: { agentId, locationId, contactId, summary: `[Call] ${summary}` },
                update: { summary: `[Last call] ${summary}` },
              })
            }
          } catch {}
        }
      } catch (err) {
        console.error('[Vapi] Error saving call log:', err)
      }
    }

    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}
