/**
 * Vapi assistant config builder — the single source of truth.
 *
 * Before this module, three places independently built Vapi assistant
 * configs from the agent + VapiConfig state:
 *
 *   1. lib/outbound-call.ts          (for phone outbound)
 *   2. app/api/vapi/webhook/route.ts (for phone inbound)
 *   3. app/api/workspaces/.../agents/.../vapi/route.ts (for browser test)
 *
 * They drifted. Browser test calls have failed since introduction with
 * "Meeting ended due to ejection" — daily-co's generic surface for an
 * assistant config Vapi's server rejected. We never saw the actual
 * error because the rejection happens AFTER the meeting starts.
 *
 * This builder produces the canonical config that goes to either:
 *   - POST /assistant (registration time — Vapi validates synchronously
 *     and returns a typed error we can show inline on save), OR
 *   - PATCH /assistant/{id} (config update on save)
 *
 * Browser + phone + widget then reference the registered assistant by
 * id, never re-building config at call time. Shape mismatches stop
 * being a class of bug.
 */

import { db } from '@/lib/db'
import { VAPI_TOOLS } from '@/lib/voice-prompt'
import { buildVapiVoiceBlock, resolveVoiceEngine } from '@/lib/voice/vapi-adapter'

const APP_URL = process.env.APP_URL || 'https://app.voxility.ai'

// Default model + transcriber stack. Mirrors Vapi's demo "Riley"
// assistant exactly (OpenAI gpt-4.1 + Deepgram nova-3 + Vapi-native
// voice "elliot") because that's the stack we verified end-to-end
// works on Vapi's side. Each is env-overridable so an operator can
// switch tier or vendor without a code change.
const DEFAULT_MODEL_PROVIDER = process.env.VAPI_DEFAULT_MODEL_PROVIDER || 'openai'
const DEFAULT_MODEL = process.env.VAPI_DEFAULT_MODEL || 'gpt-4.1'
const DEFAULT_TRANSCRIBER_PROVIDER = process.env.VAPI_DEFAULT_TRANSCRIBER_PROVIDER || 'deepgram'
const DEFAULT_TRANSCRIBER_MODEL = process.env.VAPI_DEFAULT_TRANSCRIBER_MODEL || 'nova-3'
const DEFAULT_TRANSCRIBER_LANGUAGE = process.env.VAPI_DEFAULT_TRANSCRIBER_LANGUAGE || 'en'

/**
 * Build the system prompt for a registered Vapi assistant.
 *
 * Vapi assistants are registered once (or updated on save) — they
 * don't have per-call context like contactId or callerPhone, those
 * come in via `assistantOverrides.variableValues` at vapi.start /
 * /call time. This builder produces the STATIC portions: agent
 * identity, knowledge base, persona, qualifying questions catalogue,
 * commerce surface, fallback behaviour.
 *
 * Per-call context (contact name, recent history, etc.) is injected
 * by /api/vapi/webhook when Vapi calls back for each model turn.
 */
async function buildAssistantSystemPrompt(opts: {
  agent: { id: string; name: string; workspaceId: string; systemPrompt: string; instructions?: string | null; calendarId?: string | null; fallbackBehavior?: string | null; fallbackMessage?: string | null; agentPersonaName?: string | null }
  knowledgeEntries: Array<{ title: string; content: string; createdAt?: Date | null }>
  shopifyConnected: boolean
}): Promise<string> {
  const { agent, knowledgeEntries, shopifyConnected } = opts

  // ── TOOL-USE PREAMBLE (top of prompt) ─────────────────────────────
  // GPT-4.1 on a real-time voice call tends to answer from priors
  // rather than calling tools. The model that "knows" the answer is
  // wrong every time — voice agents serve specific businesses with
  // specific content, and the only source of truth is what's indexed
  // for THIS workspace. So we put a hard, imperative tool-use rule
  // at the very top of the prompt, before the user's systemPrompt
  // (which may say "answer questions" without mentioning tools).
  //
  // The same rule repeats at the bottom in VOICE CALL INSTRUCTIONS
  // — models attend to start + end of long prompts disproportionately.
  let prompt = '# MANDATORY TOOL USE\n\n'
  prompt += 'You serve a specific business. You do NOT know its products, prices, releases, policies, or any specifics from your training data — that knowledge is in tools you can call.\n\n'
  prompt += '**Before answering ANY question** about products, inventory, prices, releases, features, policies, hours, locations, or anything specific to this business, you MUST call `query_knowledge` first with the caller\'s question phrased as a search query. Treat this as non-negotiable.\n\n'
  prompt += 'If `query_knowledge` returns nothing useful, say so honestly. Do not guess. Do not fall back to general knowledge from your training.\n\n'

  if (shopifyConnected) {
    prompt += 'When the caller asks about anything purchasable (products, sizes, stock, prices, orders), use the Shopify tools instead: `search_shopify_products`, `check_shopify_inventory`, `lookup_shopify_customer`, `check_shopify_order_status`. Never invent product details.\n\n'
  }

  prompt += `Knowledge base contents: ${knowledgeEntries.length} indexed items covering this business. Reach them via \`query_knowledge\`.\n\n`
  prompt += '---\n\n'

  // ── USER-DEFINED SYSTEM PROMPT ─────────────────────────────────────
  prompt += agent.systemPrompt || 'You are a helpful voice assistant.'

  if (agent.instructions) {
    prompt += `\n\n## Additional Instructions\n${agent.instructions}`
  }

  // ── COMMERCE BLOCK ─────────────────────────────────────────────────
  // Shopify-specific tool descriptions (when connected) — listed by
  // buildVoiceCommerceBlock so the model knows what each Shopify tool
  // is for and when to call which.
  if (shopifyConnected) {
    try {
      const { buildVoiceCommerceBlock } = await import('@/lib/commerce/shopify/voice-prompt')
      const commerceBlock = await buildVoiceCommerceBlock({ workspaceId: agent.workspaceId })
      if (commerceBlock) prompt += commerceBlock
    } catch (err: any) {
      console.warn(`[vapi-assistant] commerce block failed for ${agent.id}:`, err?.message)
    }
  }

  if (agent.calendarId) {
    prompt += `\n\n## Calendar Configuration\nCalendar ID for booking: ${agent.calendarId}\nAlways use get_available_slots before booking.`
  }

  // ── VOICE CALL INSTRUCTIONS (bottom of prompt — repeats tool rule) ──
  prompt += '\n\n## VOICE CALL INSTRUCTIONS\n'
  prompt += 'You are on a live phone call. Speak naturally and conversationally. Keep responses SHORT — 1-3 sentences max. No bullet points, no markdown.\n\n'
  prompt += '**REMINDER:** Before answering any question with specifics, call `query_knowledge` first (or a Shopify tool when commerce-related). A two-second "let me check" beat sounds natural; silence while a tool runs sounds dead, so always pre-acknowledge ("let me check that for you", "one sec, looking that up").\n'

  // Fallback behaviour
  const fb = agent.fallbackBehavior ?? 'message'
  const fm = agent.fallbackMessage
  prompt += '\n\n## When Tools Return Nothing\nDo NOT guess. Do NOT invent answers from your training data.'
  if (fb === 'transfer') {
    prompt += ' Tell the caller you\'ll connect them with someone who can help.'
  } else if (fm) {
    prompt += ` Say: "${fm}"`
  } else {
    prompt += ' Say you\'ll find out and get back to them.'
  }

  return prompt
}

/**
 * Convert an Anthropic-format tool definition (input_schema-style) into
 * Vapi's function-call shape. Used to register the catalogue's Shopify
 * tools onto a voice agent's assistant config without re-typing them.
 */
function anthropicToolToVapi(t: { name: string; description: string; input_schema: Record<string, unknown> }) {
  return {
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }
}

/**
 * The 7 Shopify tool names the catalogue exposes. Voice agents on
 * workspaces with Shopify connected get all of these registered on
 * their Vapi assistant; the webhook dispatches them via executeTool.
 */
const SHOPIFY_VOICE_TOOL_NAMES = [
  'search_shopify_products',
  'check_shopify_inventory',
  'lookup_shopify_customer',
  'check_shopify_order_status',
  'create_shopify_checkout',
  'create_shopify_discount',
  'record_back_in_stock_interest',
] as const

export interface BuildAssistantOpts {
  agentId: string
  /** Override the model id (defaults to VAPI_DEFAULT_MODEL or 'gpt-4.1'). */
  modelId?: string
  /** Override the model provider (defaults to VAPI_DEFAULT_MODEL_PROVIDER or 'openai'). */
  modelProvider?: string
  /** Override the transcriber provider (defaults to VAPI_DEFAULT_TRANSCRIBER_PROVIDER or 'deepgram'). */
  transcriberProvider?: string
  /** Override the transcriber model (defaults to VAPI_DEFAULT_TRANSCRIBER_MODEL or 'nova-3'). */
  transcriberModel?: string
}

/**
 * Build the full assistant config to POST/PATCH to Vapi.
 *
 * Loads the agent + vapiConfig + knowledge from DB. Caller is
 * responsible for handling lifecycle (createAssistant on first call,
 * updateAssistant when the id already exists).
 *
 * Returns `null` when the agent has no VapiConfig (not voice-enabled
 * yet) — caller decides what to do (skip, throw, etc.).
 */
export async function buildVapiAssistantConfig(opts: BuildAssistantOpts): Promise<Record<string, unknown> | null> {
  const { agentId, modelId, modelProvider, transcriberProvider, transcriberModel } = opts

  const agent = await db.agent.findUnique({ where: { id: agentId } })
  if (!agent) throw new Error(`buildVapiAssistantConfig: agent ${agentId} not found`)

  const vapiConfig = await db.vapiConfig.findUnique({ where: { agentId } })
  if (!vapiConfig) return null

  // Hydrate knowledge base for the system prompt. Used as ambient
  // grounding (5 most-recent entries); the rest is reached via the
  // query_knowledge tool at turn time.
  let knowledgeEntries: Array<{ title: string; content: string; createdAt?: Date | null }> = []
  try {
    const { bulkLoadKnowledgeForAgents } = await import('@/lib/knowledge')
    const map = await bulkLoadKnowledgeForAgents([agentId])
    knowledgeEntries = (map.get(agentId) ?? []).map((e: any) => ({
      title: String(e.title ?? ''),
      content: String(e.content ?? ''),
      createdAt: e.createdAt ?? null,
    }))
  } catch (err: any) {
    console.warn(`[vapi-assistant] knowledge hydration failed for ${agentId}:`, err?.message)
  }

  // Detect Shopify connection so the system prompt + tool list can
  // include commerce capabilities when relevant. Best-effort — a DB
  // blip or missing workspaceId falls through to "no Shopify" and the
  // agent keeps working (it just can't quote inventory until then).
  let shopifyConnected = false
  if (agent.workspaceId) {
    try {
      const { getShopifyConnection } = await import('@/lib/commerce/shopify/token-store')
      shopifyConnected = !!(await getShopifyConnection(agent.workspaceId))
    } catch (err: any) {
      console.warn(`[vapi-assistant] shopify lookup failed for ${agentId}:`, err?.message)
    }
  }

  const systemPrompt = await buildAssistantSystemPrompt({
    agent: agent as any,
    knowledgeEntries,
    shopifyConnected,
  })

  const voiceBlock = buildVapiVoiceBlock({
    engine: resolveVoiceEngine(vapiConfig.ttsProvider),
    voiceId: vapiConfig.voiceId,
    stability: vapiConfig.stability,
    similarityBoost: vapiConfig.similarityBoost,
    speed: vapiConfig.speed,
    style: vapiConfig.style,
    language: vapiConfig.language,
  })

  const customTools = ((vapiConfig.voiceTools as any[]) || []).map(({ condition, ...rest }: any) => rest)

  // Append the 7 Shopify tools when the workspace has a store
  // connected. Schemas come from the canonical tool-catalog (the same
  // source the text-agent path uses) and get reshaped to Vapi's
  // function-call envelope. Webhook dispatcher delegates to executeTool
  // so we never duplicate the Shopify adapter logic.
  let shopifyTools: Array<ReturnType<typeof anthropicToolToVapi>> = []
  if (shopifyConnected) {
    try {
      const { AGENT_TOOLS } = await import('@/lib/agent/tool-catalog')
      const byName = new Map((AGENT_TOOLS as any[]).map(t => [t.name, t]))
      shopifyTools = SHOPIFY_VOICE_TOOL_NAMES
        .map(name => byName.get(name))
        .filter(Boolean)
        .map(anthropicToolToVapi)
    } catch (err: any) {
      console.warn(`[vapi-assistant] shopify tool catalog import failed for ${agentId}:`, err?.message)
    }
  }

  return {
    name: agent.name,
    // Riley-stack default: OpenAI gpt-4.1 brain. Vapi has built-in
    // OpenAI access so this works without an Anthropic key wired into
    // the Vapi account. Operators can swap via env or per-call opts.
    model: {
      provider: modelProvider || DEFAULT_MODEL_PROVIDER,
      model: modelId || DEFAULT_MODEL,
      messages: [{ role: 'system', content: systemPrompt }],
      tools: [...VAPI_TOOLS, ...shopifyTools, ...customTools],
    },
    // Deepgram nova-3 transcriber. Same model Vapi's "Riley" demo
    // uses; significantly better than the previous (unset → Vapi
    // default) STT path on a phone-bandwidth codec.
    transcriber: {
      provider: transcriberProvider || DEFAULT_TRANSCRIBER_PROVIDER,
      model: transcriberModel || DEFAULT_TRANSCRIBER_MODEL,
      language: vapiConfig.language || DEFAULT_TRANSCRIBER_LANGUAGE,
    },
    voice: voiceBlock,
    firstMessage: vapiConfig.firstMessage || `Hi, this is ${(agent as any).agentPersonaName || agent.name}. How can I help today?`,
    endCallMessage: vapiConfig.endCallMessage || 'Thanks. Have a great day!',
    maxDurationSeconds: vapiConfig.maxDurationSecs ?? 600,
    ...(vapiConfig.backgroundSound ? { backgroundSound: vapiConfig.backgroundSound } : {}),
    ...(vapiConfig.endCallPhrases?.length ? { endCallPhrases: vapiConfig.endCallPhrases } : {}),
    // Webhook callback — Vapi POSTs to this URL for each model turn,
    // tool call, and lifecycle event. Same shape for browser + phone
    // (Vapi's docs say `server` nested is what they want on the
    // assistant object specifically, regardless of how the call started).
    server: { url: `${APP_URL}/api/vapi/webhook` },
  }
}

/**
 * Ensure the agent has a registered Vapi assistant. Returns the
 * vapiAssistantId.
 *
 * Idempotent — safe to call from anywhere. On first call: creates
 * the assistant via Vapi and persists the id. On subsequent calls:
 * returns the persisted id, or re-creates if the upstream assistant
 * is gone.
 *
 * Throws a typed VapiError on shape problems (caller surfaces to user).
 */
export async function ensureVapiAssistant(agentId: string): Promise<string> {
  const { createAssistant } = await import('@/lib/vapi-client')

  const vapiConfig = await db.vapiConfig.findUnique({ where: { agentId } })
  if (!vapiConfig) {
    throw new Error(`ensureVapiAssistant: agent ${agentId} has no VapiConfig`)
  }
  if (vapiConfig.vapiAssistantId) {
    return vapiConfig.vapiAssistantId
  }
  const config = await buildVapiAssistantConfig({ agentId })
  if (!config) {
    throw new Error(`ensureVapiAssistant: could not build assistant config for ${agentId}`)
  }
  const created = await createAssistant(config)
  await db.vapiConfig.update({
    where: { agentId },
    data: { vapiAssistantId: created.id },
  })
  return created.id
}

/**
 * Refresh the registered assistant after a config change. Creates
 * one if missing, otherwise PATCHes. Returns the assistant id.
 */
export async function syncVapiAssistant(agentId: string): Promise<string> {
  const { createAssistant, updateAssistant } = await import('@/lib/vapi-client')

  const vapiConfig = await db.vapiConfig.findUnique({ where: { agentId } })
  if (!vapiConfig) {
    throw new Error(`syncVapiAssistant: agent ${agentId} has no VapiConfig`)
  }
  const config = await buildVapiAssistantConfig({ agentId })
  if (!config) {
    throw new Error(`syncVapiAssistant: could not build assistant config for ${agentId}`)
  }

  if (vapiConfig.vapiAssistantId) {
    try {
      const updated = await updateAssistant(vapiConfig.vapiAssistantId, config)
      return updated.id
    } catch (err: any) {
      // Vapi may 404 if the assistant was deleted out-of-band — fall
      // through to create a new one and re-persist the id.
      const status = err?.status
      if (status !== 404) throw err
      console.warn(`[vapi-assistant] assistant ${vapiConfig.vapiAssistantId} 404'd; re-creating.`)
    }
  }

  const created = await createAssistant(config)
  await db.vapiConfig.update({
    where: { agentId },
    data: { vapiAssistantId: created.id },
  })
  return created.id
}

/**
 * Delete the registered assistant if one exists. Best-effort —
 * swallows errors so an agent delete isn't blocked by Vapi cleanup.
 */
export async function tearDownVapiAssistant(agentId: string): Promise<void> {
  const { deleteAssistant } = await import('@/lib/vapi-client')
  const vapiConfig = await db.vapiConfig.findUnique({
    where: { agentId },
    select: { vapiAssistantId: true },
  })
  if (!vapiConfig?.vapiAssistantId) return
  try {
    await deleteAssistant(vapiConfig.vapiAssistantId)
  } catch (err: any) {
    console.warn(`[vapi-assistant] teardown for ${agentId} failed:`, err?.message)
  }
}
