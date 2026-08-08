/**
 * Model registry — maps a logical key to a concrete provider + vendor
 * model id + capabilities.
 *
 * Everything non-Claude routes through OpenRouter on the ONE
 * OPENROUTER_API_KEY — that is OpenRouter's whole point: a single key,
 * and the model is a routing detail, not a credential decision. The
 * per-vendor env family this file used to carry (DEEPSEEK_HOSTING /
 * _BASE_URL / _API_KEY / _MODEL_*) is gone, and any values still set for
 * those names are deliberately ignored — a stale first-party model id
 * leaking into an OpenRouter request would 404 every call onto the
 * Claude fallback and silently burn Anthropic credits.
 *
 * Claude stays direct-to-Anthropic: it is the escalation target for
 * vision, MCP, and cheap-model failure, and the direct SDK path is what
 * carries prompt caching and server-side MCP.
 */

import type { LlmModelKey, ResolvedKey, ResolvedModel } from './types'

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'

// OpenRouter model ids, vendor-prefixed. Hardcoded: swapping the routed
// model is a code change reviewed like any other, not a per-environment
// variable that can drift between deploys.
const DEEPSEEK_FLASH = 'deepseek/deepseek-v4-flash'
const DEEPSEEK_PRO = 'deepseek/deepseek-v4-pro'

/** Claude is the escalation/fallback target — always available, full caps. */
export const CLAUDE_FALLBACK_KEY: ResolvedKey = 'claude-sonnet'

export const REGISTRY: Record<ResolvedKey, ResolvedModel> = {
  'claude-opus': {
    key: 'claude-opus',
    provider: 'anthropic',
    vendorModelId: process.env.CLAUDE_OPUS_MODEL || 'claude-opus-4-7',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    capabilities: { vision: true, mcpServers: true, toolReliability: 'high' },
  },
  'claude-sonnet': {
    key: 'claude-sonnet',
    provider: 'anthropic',
    vendorModelId: process.env.CLAUDE_AGENT_MODEL || 'claude-sonnet-4-6',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    capabilities: { vision: true, mcpServers: true, toolReliability: 'high' },
  },
  'claude-haiku': {
    key: 'claude-haiku',
    provider: 'anthropic',
    vendorModelId: process.env.CLAUDE_HAIKU_MODEL || 'claude-haiku-4-5',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    capabilities: { vision: true, mcpServers: true, toolReliability: 'medium' },
  },
  'deepseek-flash': {
    key: 'deepseek-flash',
    provider: 'openai-compat',
    vendorModelId: DEEPSEEK_FLASH,
    baseURL: OPENROUTER_BASE_URL,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    capabilities: { vision: false, mcpServers: false, toolReliability: 'medium' },
  },
  'deepseek-pro': {
    key: 'deepseek-pro',
    provider: 'openai-compat',
    vendorModelId: DEEPSEEK_PRO,
    baseURL: OPENROUTER_BASE_URL,
    apiKeyEnv: 'OPENROUTER_API_KEY',
    capabilities: { vision: false, mcpServers: false, toolReliability: 'high' },
  },
  // Generic OpenRouter passthrough — pick any model via OPENROUTER_MODEL.
  // Lets cost-sensitive background work (conversation mining) run on a cheap
  // OpenRouter model with a single dedicated key, independent of the shared
  // DeepSeek config.
  'openrouter': {
    key: 'openrouter',
    provider: 'openai-compat',
    // Default: Gemini 2.0 Flash — about the cheapest OpenRouter model that
    // still does forced function-calling reliably (mining needs clean JSON
    // from the emit_qa_pairs tool). Override with OPENROUTER_MODEL.
    vendorModelId: process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001',
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    capabilities: { vision: false, mcpServers: false, toolReliability: 'medium' },
  },
}

/**
 * What `auto` resolves to — the fleet default, hardcoded by choice
 * (previously the DEFAULT_AGENT_MODEL env var, which nobody set, so the
 * fleet silently ran on Claude).
 *
 * DeepSeek carries the routine traffic for cost; Claude stays the
 * escalation target (CLAUDE_FALLBACK_KEY) for vision, MCP, and outright
 * DeepSeek failure. So ANTHROPIC_API_KEY remains required, and
 * DEEPSEEK_API_KEY must be set or every agent call pays a failed
 * DeepSeek attempt before landing on Claude anyway.
 */
function defaultKey(): ResolvedKey {
  return 'deepseek-flash'
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
