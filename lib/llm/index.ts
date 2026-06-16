/**
 * Provider-agnostic LLM entry point.
 *
 * `createMessage(modelKey, params)` is the one call the rest of the app
 * makes. It resolves the logical model, escalates to Claude when the
 * cheaper model can't serve the request (images, server-side MCP tools),
 * runs the provider with retry, and falls back to Claude if a DeepSeek
 * call fails outright — so cost drops by default without risking a dropped
 * customer reply.
 *
 * Returns the Anthropic-shaped `LlmResponse` the agent loop already reads
 * (`content` / `stop_reason` / `usage`), so callers barely change.
 */

import type { LlmCreateParams, LlmMessageParam, LlmModelKey, LlmResponse } from './types'
import { resolveKey, getModel, CLAUDE_FALLBACK_KEY } from './registry'
import { callAnthropic, callOpenAICompat } from './providers'

export type { LlmCreateParams, LlmResponse } from './types'

function hasImages(messages: LlmMessageParam[]): boolean {
  return messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image'))
}

function dispatch(model: ReturnType<typeof getModel>, params: LlmCreateParams): Promise<LlmResponse> {
  return model.provider === 'anthropic' ? callAnthropic(model, params) : callOpenAICompat(model, params)
}

function logCost(requested: string, used: string, usage: { input_tokens: number; output_tokens: number }, reason: string) {
  console.info(`[llm] requested=${requested} used=${used} in=${usage.input_tokens} out=${usage.output_tokens}${reason ? ` fellBack=${reason}` : ''}`)
}

export async function createMessage(
  modelKey: LlmModelKey | string | null | undefined,
  params: LlmCreateParams,
): Promise<LlmResponse> {
  const requested = resolveKey(modelKey)
  let model = getModel(requested)
  let reason = ''

  // Capability-aware escalation to Claude BEFORE the call.
  if (!model.capabilities.vision && hasImages(params.messages)) {
    model = getModel(CLAUDE_FALLBACK_KEY)
    reason = 'vision'
  } else if (!model.capabilities.mcpServers && Array.isArray(params.mcp_servers) && params.mcp_servers.length > 0) {
    model = getModel(CLAUDE_FALLBACK_KEY)
    reason = 'mcp'
  }

  try {
    const res = await dispatch(model, params)
    logCost(requested, model.key, res.usage, reason)
    return res
  } catch (err) {
    // Reliability escalation: a DeepSeek call failed after its own retries →
    // fall back to Claude once so the customer still gets a reply.
    if (model.key.startsWith('deepseek')) {
      console.warn(`[llm] ${model.key} failed (${(err as Error)?.message ?? err}); falling back to Claude`)
      const claude = getModel(CLAUDE_FALLBACK_KEY)
      const res = await dispatch(claude, params)
      logCost(requested, claude.key, res.usage, 'error')
      return res
    }
    throw err
  }
}
