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

import type { LlmCreateParams, LlmMessageParam, LlmModelKey, LlmResponse, ProviderKind, ResolvedModel } from './types'
import { resolveKey, getModel, CLAUDE_FALLBACK_KEY } from './registry'
import { callAnthropic, callOpenAICompat } from './providers'

/**
 * Hard-coded, NON-env-overridable known-good model. Used only as the very last
 * resort when the configured/baseline model returns 404 model-not-found (a
 * retired or mistyped id — including a bad CLAUDE_*_MODEL env value, since this
 * id is independent of env). Keeps customers answered while the real config is
 * fixed, instead of 404ing every inbound for days. Bump this when the whole
 * Sonnet line moves — but a stale CONFIG id self-heals onto this regardless.
 */
const LAST_RESORT_MODEL: ResolvedModel = {
  key: 'claude-sonnet',
  provider: 'anthropic',
  vendorModelId: 'claude-sonnet-4-6',
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  capabilities: { vision: true, mcpServers: true, toolReliability: 'high' },
}

/** A 404 from the Messages API means the requested model id isn't served
 *  (retired / mistyped). Anthropic returns status 404 with a not_found_error. */
export function isModelNotFound(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: unknown } | null
  if (e?.status === 404) return true
  const msg = `${e?.message ?? ''} ${typeof e?.error === 'string' ? e.error : JSON.stringify(e?.error ?? '')}`
  return /not_found_error|model[^.]{0,30}(not\s*(found|supported|exist)|is\s*not)/i.test(msg)
}

// Best-effort throttle so a retired model id fires ONE config alert per id
// per warm instance per hour, not one per inbound.
const invalidModelAlertedAt = new Map<string, number>()
const MODEL_ALERT_THROTTLE_MS = 60 * 60_000

function warnInvalidModel(badId: string, meta?: LlmCallMeta): void {
  console.error(
    `[llm] model '${badId}' is not available (404) — auto-recovered on '${LAST_RESORT_MODEL.vendorModelId}'. ` +
    `UPDATE THE CONFIGURED MODEL ID (lib/llm/registry.ts default or the CLAUDE_*_MODEL env var).`,
  )
  const now = Date.now()
  if (now - (invalidModelAlertedAt.get(badId) ?? 0) < MODEL_ALERT_THROTTLE_MS) return
  invalidModelAlertedAt.set(badId, now)
  if (meta?.workspaceId) {
    import('@/lib/notifications')
      .then(({ notify }) => notify({
        workspaceId: meta.workspaceId!,
        event: 'agent_error',
        title: 'Model config needs update (auto-recovered)',
        body: `The configured AI model "${badId}" is no longer available; replies are being auto-served by ${LAST_RESORT_MODEL.vendorModelId}. No customer impact, but the model ID should be updated.`,
        severity: 'error',
      }))
      .catch(() => { /* alert is best-effort */ })
  }
}

/**
 * True when a provider's credential env var is absent or blank on THIS
 * deployment. Blank counts as missing: `Bearer ` reads to the provider as
 * no credential at all.
 */
export function providerKeyMissing(model: Pick<ResolvedModel, 'apiKeyEnv'>): boolean {
  return !(process.env[model.apiKeyEnv] ?? '').trim()
}

// Same throttle shape as the model-not-found alert: ONE config alert per
// env var per warm instance per hour, not one per inbound.
const missingKeyAlertedAt = new Map<string, number>()

/**
 * A provider whose credential is unset cannot serve a single request — every
 * call 401s in milliseconds and lands on the Claude fallback, which in the
 * logs is indistinguishable from "the cheap model is having a bad day."
 *
 * That ambiguity is expensive. Renaming this exact credential
 * (DEEPSEEK_API_KEY → OPENROUTER_API_KEY) without creating the new name hid
 * for five days while 100% of fleet traffic silently ran on Claude, drained
 * the Anthropic balance, and took every agent reply down with it when the
 * balance hit zero. So: name it as the deployment config error it is, say
 * which variable, and say that it must exist on EVERY Vercel project that
 * deploys this repo — the widget runtime has its own env, and a variable
 * added only to the dashboard project reaches none of the chat traffic.
 */
function warnMissingProviderKey(model: ResolvedModel, meta?: LlmCallMeta): void {
  console.error(
    `[llm] CONFIG ERROR: ${model.apiKeyEnv} is unset on this deployment, so '${model.key}' cannot serve any ` +
    `request — every call is falling back to ${CLAUDE_FALLBACK_KEY} and billing Anthropic. ` +
    `SET ${model.apiKeyEnv} ON EVERY VERCEL PROJECT THAT DEPLOYS THIS REPO (dashboard AND widget runtime), then redeploy.`,
  )
  const now = Date.now()
  if (now - (missingKeyAlertedAt.get(model.apiKeyEnv) ?? 0) < MODEL_ALERT_THROTTLE_MS) return
  missingKeyAlertedAt.set(model.apiKeyEnv, now)
  if (meta?.workspaceId) {
    import('@/lib/notifications')
      .then(({ notify }) => notify({
        workspaceId: meta.workspaceId!,
        event: 'agent_error',
        title: `${model.apiKeyEnv} is missing — paying Anthropic prices for every reply`,
        body: `'${model.key}' is the configured default but ${model.apiKeyEnv} is not set on this deployment, so every reply is being served by ${CLAUDE_FALLBACK_KEY} instead. Replies still work, but at several times the intended cost, and an Anthropic billing lapse would now take the agent down completely. Set ${model.apiKeyEnv} on every Vercel project that deploys this repo, then redeploy.`,
        severity: 'error',
      }))
      .catch(() => { /* alert is best-effort */ })
  }
}

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
    // Fail the call BEFORE the network round-trip when the credential is
    // simply absent. The fallback below still answers the customer, but the
    // cause is now stated once, loudly, instead of arriving as an opaque
    // provider 401 that reads like a transient blip.
    if (providerKeyMissing(model)) {
      warnMissingProviderKey(model, meta)
      throw new Error(`[llm] ${model.apiKeyEnv} is not set — '${model.key}' cannot be called`)
    }
    const res = await dispatch(model, params)
    logCost(requested, model.key, res.usage, reason)
    recordUsage(model.key, model.provider, res.usage, !!reason, meta)
    return res
  } catch (err) {
    let lastErr = err
    let failedModel = model

    // (1) Reliability escalation: the agent's chosen model failed after its own
    // retries → fall back to baseline Claude ONCE so the customer still gets a
    // reply. Covers every non-baseline model (DeepSeek, Haiku, Opus,
    // OpenRouter). Skipped when the failed model already IS the baseline.
    // Callers that would rather fail than spend Anthropic credits (batch/cron)
    // pass meta.noFallback.
    if (model.key !== CLAUDE_FALLBACK_KEY && !meta?.noFallback) {
      console.warn(`[llm] ${model.key} failed (${(err as Error)?.message ?? err}); falling back to ${CLAUDE_FALLBACK_KEY}`)
      const claude = getModel(CLAUDE_FALLBACK_KEY)
      try {
        const res = await dispatch(claude, params)
        logCost(requested, claude.key, res.usage, 'error')
        recordUsage(claude.key, claude.provider, res.usage, true, meta)
        return res
      } catch (claudeErr) {
        lastErr = claudeErr
        failedModel = claude
      }
    }

    // (2) Model-not-found self-heal: the configured/baseline model id is
    // retired or mistyped (404) — including a bad CLAUDE_*_MODEL env value,
    // which the baseline reads but LAST_RESORT_MODEL does not. Retry ONCE on a
    // hard-coded known-good model so a stale id degrades gracefully instead of
    // 404ing every inbound, and fire one throttled config alert. Re-throws if
    // even the last-resort id is gone (the whole line is retired) — then the
    // agent runner classifies it model_rejected and pages, as before.
    if (isModelNotFound(lastErr) && failedModel.vendorModelId !== LAST_RESORT_MODEL.vendorModelId && !meta?.noFallback) {
      warnInvalidModel(failedModel.vendorModelId, meta)
      const res = await dispatch(LAST_RESORT_MODEL, params)
      logCost(requested, `${LAST_RESORT_MODEL.key}(last-resort)`, res.usage, 'model_not_found')
      recordUsage(LAST_RESORT_MODEL.key, LAST_RESORT_MODEL.provider, res.usage, true, meta)
      return res
    }

    throw lastErr
  }
}
