/**
 * Provider dispatch — turns a canonical (Anthropic-shaped) request into an
 * actual API call.
 *
 *  - `anthropic`     → @anthropic-ai/sdk, pass-through. Serves Claude AND
 *                      first-party DeepSeek (base URL `…/anthropic`).
 *  - `openai-compat` → fetch against an OpenAI Chat Completions endpoint
 *                      (Western-hosted DeepSeek), translating in/out.
 *
 * Both return the Anthropic-shaped `LlmResponse` the agent loop expects.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LlmCreateParams, LlmResponse, ResolvedModel } from './types'
import { anthropicToOpenAIRequest, openAIToAnthropicResponse } from './openai-translate'

// One client per (baseURL, key) combo.
const anthropicClients = new Map<string, Anthropic>()
function anthropicClient(model: ResolvedModel): Anthropic {
  const cacheKey = `${model.baseURL ?? 'default'}|${model.apiKeyEnv}`
  let c = anthropicClients.get(cacheKey)
  if (!c) {
    c = new Anthropic({
      apiKey: process.env[model.apiKeyEnv],
      ...(model.baseURL ? { baseURL: model.baseURL } : {}),
    })
    anthropicClients.set(cacheKey, c)
  }
  return c
}

export async function callAnthropic(model: ResolvedModel, params: LlmCreateParams): Promise<LlmResponse> {
  const client = anthropicClient(model)
  const { createMessageWithRetry } = await import('../anthropic-resilient')
  // Provider is authoritative for the vendor model id.
  const res = await createMessageWithRetry(client, { ...params, model: model.vendorModelId } as never)
  return res as unknown as LlmResponse
}

const MAX_ATTEMPTS = 3
const BASE_DELAY_MS = 800

export async function callOpenAICompat(model: ResolvedModel, params: LlmCreateParams): Promise<LlmResponse> {
  const body = anthropicToOpenAIRequest(params, model.capabilities.vision)
  body.model = model.vendorModelId
  const url = `${(model.baseURL ?? '').replace(/\/$/, '')}/chat/completions`
  const json = await postWithRetry(url, process.env[model.apiKeyEnv], body)
  return openAIToAnthropicResponse(json) as LlmResponse
}

interface MaybeRetryable extends Error { retryable?: boolean }

async function postWithRetry(url: string, apiKey: string | undefined, body: unknown): Promise<{ choices: Array<{ message: { role: string; content: string | null; tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }; finish_reason: string | null }>; usage: { prompt_tokens: number; completion_tokens: number }; model?: string }> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey ?? ''}` },
        body: JSON.stringify(body),
      })
      if (r.ok) return await r.json()
      const text = await r.text().catch(() => '')
      const err = new Error(`[llm] openai-compat HTTP ${r.status}: ${text.slice(0, 300)}`) as MaybeRetryable
      err.retryable = r.status === 429 || r.status >= 500
      throw err
    } catch (err) {
      lastErr = err
      // Network/fetch throws have no `retryable` flag → treat as retryable.
      const nonRetryable = (err as MaybeRetryable)?.retryable === false
      if (attempt === MAX_ATTEMPTS - 1 || nonRetryable) throw err
      const delay = BASE_DELAY_MS * 2 ** attempt + ((attempt * 137) % 250)
      console.warn(`[llm] openai-compat retryable error, attempt ${attempt + 1}/${MAX_ATTEMPTS}, backing off ${delay}ms`)
      await new Promise(res => setTimeout(res, delay))
    }
  }
  throw lastErr
}
