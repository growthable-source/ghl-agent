import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'

/**
 * Authenticate the webhook. Vapi echoes an assistant's (or phone
 * number's) `server.secret` back as the `x-vapi-secret` header on every
 * event. Tool dispatch here has real side effects (booking, SMS,
 * tagging), so with VAPI_WEBHOOK_SECRET set we hard-reject anything
 * that doesn't carry it. Unset = open webhook; we allow it for
 * back-compat but scream in the logs — set the env var, then re-save
 * each voice agent (sync re-registers the secret onto the assistant).
 */
function verifyWebhookSecret(req: NextRequest): boolean {
  const expected = process.env.VAPI_WEBHOOK_SECRET
  if (!expected) {
    console.error('[Vapi webhook] VAPI_WEBHOOK_SECRET is not set — webhook is UNAUTHENTICATED. Set it and re-sync voice agents.')
    return true
  }
  const got = req.headers.get('x-vapi-secret') ?? ''
  const a = Buffer.from(got)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function findAgentByPhoneNumber(phoneNumber: string) {
  return db.vapiConfig.findFirst({
    where: { phoneNumber, isActive: true },
    include: { agent: true },
  })
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
        select: { workspaceId: true, knowledgeDomainIds: true, knowledgeScopeAll: true, knowledgeConditions: true },
      })
      if (!agent || !agent.workspaceId) return 'Agent not found or not assigned to a workspace.'
      const query: string = typeof params.query === 'string' ? params.query : ''
      if (!query.trim()) return 'No query provided — please ask again with a specific question.'
      const { retrieveAndFormatForAgent, normaliseConditions } = await import('@/lib/agent/retrieve-for-agent')
      const { block, chunks } = await retrieveAndFormatForAgent(
        { id: ctx.agentId, workspaceId: agent.workspaceId, knowledgeDomainIds: agent.knowledgeDomainIds, knowledgeScopeAll: agent.knowledgeScopeAll, knowledgeConditions: normaliseConditions(agent.knowledgeConditions) },
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
  if (!verifyWebhookSecret(req)) {
    console.warn('[Vapi webhook] rejected: bad or missing x-vapi-secret. If this is a legitimate Vapi event, the assistant/phone number was registered before VAPI_WEBHOOK_SECRET was set — re-save the agent to re-sync.')
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
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

  // ── Assistant request — hand the call to the REGISTERED assistant ──
  //
  // Historically this handler built a full inline assistant per call
  // (Anthropic model + inline model.tools). That was the last remnant
  // of the pre-registration architecture and diverged from every other
  // path: different brain, and inline tools that Vapi doesn't dispatch
  // (webhook never fired — inbound agents effectively had NO tools).
  // Now inbound answers with the same registered assistant browser /
  // widget / outbound use, plus per-call overrides.
  if (messageType === 'assistant-request') {
    const call = message.call
    const callerPhone: string = call?.customer?.number || ''
    const toPhone: string = call?.phoneNumber?.number || ''

    const vapiConfig = await findAgentByPhoneNumber(toPhone)

    if (!vapiConfig?.agent) {
      // No agent bound to this number — decline with a spoken-ish error
      // rather than improvising an unconfigured assistant.
      return NextResponse.json({ error: 'This number is not configured yet.' })
    }

    const agent = vapiConfig.agent
    const locationId = agent.locationId

    // Quota gate — inbound was the one path that never checked, so a
    // workspace over its minutes kept receiving billable calls.
    if (agent.workspaceId) {
      try {
        const { checkVoiceQuota } = await import('@/lib/voice-quota')
        const quota = await checkVoiceQuota(agent.workspaceId)
        if (!quota.ok) {
          console.warn('[Vapi webhook] inbound blocked by quota:', { agentId: agent.id, code: quota.code })
          return NextResponse.json({ error: 'This line is temporarily unavailable. Please try again later.' })
        }
      } catch (err: any) {
        console.warn('[Vapi webhook] quota check failed (allowing call):', err?.message)
      }
    }

    let assistantId: string
    try {
      const { ensureVapiAssistant } = await import('@/lib/voice/vapi-assistant')
      assistantId = await ensureVapiAssistant(agent.id)
    } catch (err: any) {
      console.error('[Vapi webhook] assistant resolution failed:', err?.message)
      return NextResponse.json({ error: 'This line is temporarily unavailable. Please try again later.' })
    }

    // Resolve the caller to a contact so merge fields in first/end
    // messages render and the agent knows who's calling. Best-effort —
    // unknown numbers are normal for inbound.
    let voiceContact: any = null
    try {
      const { searchContacts } = await import('@/lib/crm-client')
      const matches = callerPhone ? await searchContacts(locationId, callerPhone) : []
      voiceContact = matches.find(c => c.phone === callerPhone) ?? matches[0] ?? null
    } catch { /* non-fatal */ }
    const { renderMergeFields, resolveAssignedUser, hydrateContactCustomFields } = await import('@/lib/merge-fields')
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

    // Per-call context for the registered prompt's {{callContext}} slot.
    const contactName = [hydratedContact?.firstName, hydratedContact?.lastName].filter(Boolean).join(' ')
      || hydratedContact?.name || null
    const callContext = [
      `Inbound phone call from ${callerPhone || 'an unknown number'}.`,
      contactName ? `The caller matches an existing contact: ${contactName}.` : 'The caller does not match any known contact.',
    ].join(' ')

    return NextResponse.json({
      assistantId,
      assistantOverrides: {
        variableValues: {
          locationId,
          workspaceId: agent.workspaceId,
          agentId: agent.id,
          callerPhone,
          direction: 'inbound',
          callContext,
        },
        firstMessage: renderMergeFields(
          vapiConfig.firstMessage || `Hi there! This is ${agent.agentPersonaName || agent.name}. How can I help you today?`,
          mergeCtx,
        ),
        endCallMessage: renderMergeFields(
          vapiConfig.endCallMessage || 'Thanks for calling. Have a great day!',
          mergeCtx,
        ),
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

  // ── End of call report — save transcript/log + count the minutes ──
  //
  // Every call gets a CallLog row and counts against the workspace's
  // voice minutes — inbound, outbound, browser test, and widget alike.
  // (Browser/widget calls used to be invisible here because logging was
  // gated on a locationId those paths never send; test-call minutes
  // were free, untraceable, and uncapped.)
  //
  // Idempotency: Vapi retries webhook deliveries. The CallLog row keyed
  // by the unique vapiCallId is the ledger — we only call
  // trackVoiceUsage on the write that transitions the row from
  // "no duration yet" to finalized, so a redelivery can't double-count.
  if (messageType === 'end-of-call-report') {
    const call = message.call
    const transcript: string = message.transcript || ''
    const summary: string = message.summary || ''
    const recordingUrl: string = message.recordingUrl || ''
    const durationSecs = Math.round((call?.endedAt && call?.startedAt)
      ? (new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000
      : 0)

    const vars = call?.assistantOverrides?.variableValues || {}
    const locationId: string | null = vars.locationId || null
    const agentId: string | null = vars.agentId || null
    const callerPhone: string = vars.callerPhone || call?.customer?.number || null
    const direction: string = vars.direction || 'inbound'
    let workspaceId: string | null = vars.workspaceId || null

    try {
      if (!workspaceId && agentId) {
        const agent = await db.agent.findUnique({ where: { id: agentId }, select: { workspaceId: true } })
        workspaceId = agent?.workspaceId ?? null
      }

      const callStatus = call?.endedReason === 'customer-ended-call' ? 'completed' : (call?.endedReason || 'completed')
      const finalData = {
        status: callStatus,
        durationSecs,
        transcript,
        summary,
        recordingUrl,
        endedReason: call?.endedReason,
      }

      // Finalize-once ledger write. `shouldTrackUsage` is true only on
      // the transition into the finalized state.
      let shouldTrackUsage = false
      if (call?.id) {
        const existing = await db.callLog.findUnique({ where: { vapiCallId: call.id } })
        if (existing) {
          shouldTrackUsage = existing.durationSecs == null
          if (shouldTrackUsage) {
            await db.callLog.update({ where: { vapiCallId: call.id }, data: finalData })
          }
        } else {
          try {
            await db.callLog.create({
              data: {
                locationId, agentId, contactPhone: callerPhone,
                vapiCallId: call.id, direction, ...finalData,
              },
            })
            shouldTrackUsage = true
          } catch (createErr: any) {
            // Unique-violation on vapiCallId = concurrent retry already
            // wrote the row. Nothing to do.
            if (createErr?.code !== 'P2002') throw createErr
          }
        }
      } else {
        // No call id (shouldn't happen) — log without idempotency
        // rather than dropping the record.
        await db.callLog.create({
          data: { locationId, agentId, contactPhone: callerPhone, direction, ...finalData },
        })
        shouldTrackUsage = true
      }

      if (shouldTrackUsage && durationSecs > 0 && workspaceId) {
        try {
          const { trackVoiceUsage } = await import('@/lib/usage')
          await trackVoiceUsage(workspaceId, agentId ?? 'unknown', durationSecs)
        } catch (usageErr) {
          console.error('[Vapi] Error tracking voice usage:', usageErr)
        }
      }

      if (summary && agentId && callerPhone && locationId) {
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

    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}
