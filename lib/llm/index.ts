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

import type { LlmCreateParams, LlmMessageParam, LlmModelKey, LlmResponse, ProviderKind } from './types'
import { resolveKey, getModel, CLAUDE_FALLBACK_KEY } from './registry'
import { callAnthropic, callOpenAICompat } from './providers'

export type { LlmCreateParams, LlmResponse } from './types'

/** Optional attribution so cost can be rolled up per workspace/surface. */
export interface LlmCallMeta {
  surface: string
  workspaceId?: string | null
  agentId?: string | null
  /**
   * When true, a failed cheap-model (DeepSeek) call is NOT retried on Claude —
   * the error propagates instead. Use for cost-sensitive batch work (e.g.
   * conversation mining) where silently burning Anthropic credits is worse
   * than failing the batch and retrying later.
   */
  noFallback?: boolean
}

function hasImages(messages: LlmMessageParam[]): boolean {
  return messages.some(m => Array.isArray(m.content) && m.content.some(b => b.type === 'image'))
}

function dispatch(model: ReturnType<typeof getModel>, params: LlmCreateParams): Promise<LlmResponse> {
  return model.provider === 'anthropic' ? callAnthropic(model, params) : callOpenAICompat(model, params)
}

function logCost(requested: string, used: string, usage: { input_tokens: number; output_tokens: number }, reason: string) {
  console.info(`[llm] requested=${requested} used=${used} in=${usage.input_tokens} out=${usage.output_tokens}${reason ? ` fellBack=${reason}` : ''}`)
}

/**
 * Best-effort daily cost rollup. Fire-and-forget — never awaited on the
 * reply path, never throws (missing table pre-migration is swallowed).
 */
function recordUsage(
  usedKey: string,
  provider: ProviderKind,
  usage: LlmResponse['usage'],
  fellBack: boolean,
  meta?: LlmCallMeta,
): void {
  if (!meta) return
  const day = new Date().toISOString().slice(0, 10)
  const cacheRead = BigInt(usage.cache_read_input_tokens || 0)
  const cacheCreate = BigInt(usage.cache_creation_input_tokens || 0)
  import('@/lib/db')
    .then(({ db }) => db.llmUsageDaily.upsert({
      where: { day_workspaceId_surface_modelKey: { day, workspaceId: meta.workspaceId ?? '', surface: meta.surface, modelKey: usedKey } },
      create: {
        day, workspaceId: meta.workspaceId ?? '', surface: meta.surface, modelKey: usedKey, provider,
        calls: 1, fellBackCalls: fellBack ? 1 : 0,
        inputTokens: BigInt(usage.input_tokens || 0), outputTokens: BigInt(usage.output_tokens || 0),
        cacheReadInputTokens: cacheRead, cacheCreationInputTokens: cacheCreate,
      },
      update: {
        provider,
        calls: { increment: 1 }, fellBackCalls: { increment: fellBack ? 1 : 0 },
        inputTokens: { increment: BigInt(usage.input_tokens || 0) },
        outputTokens: { increment: BigInt(usage.output_tokens || 0) },
        cacheReadInputTokens: { increment: cacheRead },
        cacheCreationInputTokens: { increment: cacheCreate },
      },
    }))
    .catch(() => { /* telemetry only — never affects the call */ })
}

export async function createMessage(
  modelKey: LlmModelKey | string | null | undefined,
  params: LlmCreateParams,
  meta?: LlmCallMeta,
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
    recordUsage(model.key, model.provider, res.usage, !!reason, meta)
    return res
  } catch (err) {
    // Reliability escalation: a DeepSeek call failed after its own retries →
    // fall back to Claude once so the customer still gets a reply. Callers
    // that would rather fail than spend Anthropic credits (batch/cron work)
    // pass meta.noFallback.
    if (model.key.startsWith('deepseek') && !meta?.noFallback) {
      console.warn(`[llm] ${model.key} failed (${(err as Error)?.message ?? err}); falling back to Claude`)
      const claude = getModel(CLAUDE_FALLBACK_KEY)
      const res = await dispatch(claude, params)
      logCost(requested, claude.key, res.usage, 'error')
      recordUsage(claude.key, claude.provider, res.usage, true, meta)
      return res
    }
    throw err
  }
}
