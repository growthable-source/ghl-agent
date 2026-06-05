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
  agent: { id: string; name: string; systemPrompt: string; instructions?: string | null; calendarId?: string | null; fallbackBehavior?: string | null; fallbackMessage?: string | null; agentPersonaName?: string | null }
  knowledgeEntries: Array<{ title: string; content: string }>
}): Promise<string> {
  const { agent, knowledgeEntries } = opts

  let prompt = agent.systemPrompt || 'You are a helpful voice assistant.'

  if (agent.instructions) {
    prompt += `\n\n## Additional Instructions\n${agent.instructions}`
  }

  if (knowledgeEntries.length > 0) {
    prompt += '\n\n## Knowledge Base\n'
    prompt += knowledgeEntries
      .slice(0, 30) // cap to keep the prompt finite
      .map(e => `### ${e.title}\n${e.content}`)
      .join('\n\n')
  }

  if (agent.calendarId) {
    prompt += `\n\n## Calendar Configuration\nCalendar ID for booking: ${agent.calendarId}\nAlways use get_available_slots before booking.`
  }

  // Persona — short hint to keep the voice agent conversational.
  prompt += '\n\n## VOICE CALL INSTRUCTIONS\nYou are on a live phone call. Speak naturally and conversationally. Keep responses SHORT — 1-3 sentences max. No bullet points, no markdown.'

  // Fallback behaviour
  const fb = agent.fallbackBehavior ?? 'message'
  const fm = agent.fallbackMessage
  prompt += '\n\n## When You Don\'t Know the Answer\nDo NOT guess.'
  if (fb === 'transfer') {
    prompt += ' Tell the caller you\'ll connect them with someone who can help.'
  } else if (fm) {
    prompt += ` Say: "${fm}"`
  } else {
    prompt += ' Say you\'ll find out and get back to them.'
  }

  return prompt
}

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

  // Hydrate knowledge base for the system prompt.
  let knowledgeEntries: Array<{ title: string; content: string }> = []
  try {
    const { bulkLoadKnowledgeForAgents } = await import('@/lib/knowledge')
    const map = await bulkLoadKnowledgeForAgents([agentId])
    knowledgeEntries = (map.get(agentId) ?? []).map((e: any) => ({
      title: String(e.title ?? ''),
      content: String(e.content ?? ''),
    }))
  } catch (err: any) {
    console.warn(`[vapi-assistant] knowledge hydration failed for ${agentId}:`, err?.message)
  }

  const systemPrompt = await buildAssistantSystemPrompt({
    agent: agent as any,
    knowledgeEntries,
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

  return {
    name: agent.name,
    // Riley-stack default: OpenAI gpt-4.1 brain. Vapi has built-in
    // OpenAI access so this works without an Anthropic key wired into
    // the Vapi account. Operators can swap via env or per-call opts.
    model: {
      provider: modelProvider || DEFAULT_MODEL_PROVIDER,
      model: modelId || DEFAULT_MODEL,
      messages: [{ role: 'system', content: systemPrompt }],
      tools: [...VAPI_TOOLS, ...customTools],
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
