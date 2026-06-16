/**
 * Model registry — maps a logical key to a concrete provider + vendor
 * model id + capabilities. DeepSeek hosting is env-driven so first-party
 * (cheapest, China-hosted) ↔ Western host (Fireworks/OpenRouter/Azure,
 * data-residency safe) is a config change, never a code change.
 */

import type { LlmModelKey, ResolvedKey, ResolvedModel } from './types'

const HOSTING = (process.env.DEEPSEEK_HOSTING || 'openai') as 'firstparty' | 'openai'

// First-party exposes an Anthropic-compatible endpoint (`/anthropic`);
// Western hosts are OpenAI-compatible (`/v1`).
const DEEPSEEK_BASE_URL =
  process.env.DEEPSEEK_BASE_URL ||
  (HOSTING === 'firstparty' ? 'https://api.deepseek.com/anthropic' : 'https://api.deepseek.com/v1')

const DEEPSEEK_PROVIDER = HOSTING === 'firstparty' ? 'anthropic' : 'openai-compat'

// Vendor ids differ per host (e.g. Fireworks prefixes the path). Override
// via env. Defaults to the current canonical DeepSeek V4 ids.
const DEEPSEEK_FLASH = process.env.DEEPSEEK_MODEL_FLASH || 'deepseek-v4-flash'
const DEEPSEEK_PRO = process.env.DEEPSEEK_MODEL_PRO || 'deepseek-v4-pro'

/** Claude is the escalation/fallback target — always available, full caps. */
export const CLAUDE_FALLBACK_KEY: ResolvedKey = 'claude-sonnet'

export const REGISTRY: Record<ResolvedKey, ResolvedModel> = {
  'claude-sonnet': {
    key: 'claude-sonnet',
    provider: 'anthropic',
    vendorModelId: process.env.CLAUDE_AGENT_MODEL || 'claude-sonnet-4-20250514',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    capabilities: { vision: true, mcpServers: true, toolReliability: 'high' },
  },
  'claude-haiku': {
    key: 'claude-haiku',
    provider: 'anthropic',
    vendorModelId: process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5-20251001',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    capabilities: { vision: true, mcpServers: true, toolReliability: 'medium' },
  },
  'deepseek-flash': {
    key: 'deepseek-flash',
    provider: DEEPSEEK_PROVIDER,
    vendorModelId: DEEPSEEK_FLASH,
    baseURL: DEEPSEEK_BASE_URL,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    capabilities: { vision: false, mcpServers: false, toolReliability: 'medium' },
  },
  'deepseek-pro': {
    key: 'deepseek-pro',
    provider: DEEPSEEK_PROVIDER,
    vendorModelId: DEEPSEEK_PRO,
    baseURL: DEEPSEEK_BASE_URL,
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    capabilities: { vision: false, mcpServers: false, toolReliability: 'high' },
  },
}

/** What `auto` resolves to. The fleet rollout switch lives here. */
function defaultKey(): ResolvedKey {
  const d = process.env.DEFAULT_AGENT_MODEL
  return d && d in REGISTRY ? (d as ResolvedKey) : 'claude-sonnet'
}

/** Resolve any caller-supplied model key (incl. `auto`, unknown, null) to a concrete key. */
export function resolveKey(modelKey: LlmModelKey | string | null | undefined): ResolvedKey {
  const raw = modelKey || 'auto'
  if (raw === 'auto') return defaultKey()
  return raw in REGISTRY ? (raw as ResolvedKey) : defaultKey()
}

export function getModel(key: ResolvedKey): ResolvedModel {
  return REGISTRY[key]
}
