/**
 * Per-model token pricing (USD per 1M tokens) for the admin cost dashboard.
 *
 * Approximate list prices as of mid-2026 — used to turn the LlmUsageDaily
 * token rollup into dollars and to compute savings vs the Claude Sonnet
 * baseline (the model the agent ran on before DeepSeek). Override via env if
 * a host (e.g. OpenRouter markup) differs materially.
 */

export interface ModelPrice {
  inPerM: number
  outPerM: number
}

export const PRICING: Record<string, ModelPrice> = {
  'claude-opus': { inPerM: 15, outPerM: 75 },
  'claude-sonnet': { inPerM: 3, outPerM: 15 },
  'claude-haiku': { inPerM: 1, outPerM: 5 },
  'deepseek-flash': { inPerM: 0.14, outPerM: 0.28 },
  'deepseek-pro': { inPerM: 0.435, outPerM: 0.87 },
  // OpenRouter passthrough — rough default (DeepSeek-class). Override via env
  // if you point OPENROUTER_MODEL at a pricier model, so estimates stay sane.
  'openrouter': {
    inPerM: Number(process.env.OPENROUTER_PRICE_IN_PER_M) || 0.14,
    outPerM: Number(process.env.OPENROUTER_PRICE_OUT_PER_M) || 0.28,
  },
}

/** The yardstick for "savings": what the same traffic would cost on Sonnet. */
export const BASELINE_KEY = 'claude-sonnet'

export function costUsd(modelKey: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[modelKey] ?? PRICING[BASELINE_KEY]
  return (inputTokens / 1_000_000) * p.inPerM + (outputTokens / 1_000_000) * p.outPerM
}

/** Cost the same tokens would have incurred on the baseline (Sonnet). */
export function baselineCostUsd(inputTokens: number, outputTokens: number): number {
  return costUsd(BASELINE_KEY, inputTokens, outputTokens)
}
