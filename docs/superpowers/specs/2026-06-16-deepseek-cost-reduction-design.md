# DeepSeek integration for LLM cost reduction — design

**Date:** 2026-06-16
**Goal (outcome):** Reduce the platform's LLM inference spend. DeepSeek (V4-Flash/Pro, 7–50× cheaper than Claude) is the lever; a provider abstraction is the means. Every design choice is subordinate to *measurable cost reduction*.

## Success criteria

- Per-call token + model cost is recorded, so spend and savings are observable (not estimated).
- The main agent loop can run on DeepSeek by default, with Claude auto-covering the cases DeepSeek can't (vision, failures), at no perceptible quality loss to customers.
- Fleet rollout is a single switch with a per-agent override, and is reversible instantly.
- Realized agent-inference cost drops ~70–90% on traffic that doesn't escalate, proven by the telemetry.

## Current state (from codebase audit)

- **Zero provider abstraction.** `lib/ai-agent.ts:43` instantiates `new Anthropic()`; the model id `claude-sonnet-4-20250514` is hardcoded at `lib/ai-agent.ts:772`. ~28 other call sites each hardcode their own Claude model.
- **One precedent for swappable models:** `Agent.judgeModel` enum (`haiku`|`sonnet`) → `MODEL_IDS` map in `lib/approval-judge.ts:39` + a dashboard dropdown. The new design follows this pattern.
- **Resilience seam:** `lib/anthropic-resilient.ts` `createMessageWithRetry(client, params)` wraps the call with retry/backoff. Generalize it.
- **No per-call cost telemetry.** `lib/usage.ts` counts messages, not tokens. `MessageLog.tokensUsed` exists but is unreliably populated. This is the measurement gap to close first.
- **Cost center:** the main agent loop (every visitor message, Sonnet, non-streaming, ≤6 tool iterations, ~2.4k-token RAG block + history). Backend LLM calls total only ~$6.5–8.5k/yr and are mostly already Haiku; the 4 Opus ad/VSL/page generators (~$1.5–2k/yr) are the only fat backend target.

## Design principle

**Cheapest-capable by default, escalate on need.** The expensive model is the safety net, not the default. Cost falls automatically; quality is protected by capability-aware escalation; rollout is gated by config so it's controllable and reversible.

## Architecture — `lib/llm/`

A single module becomes the one way to call any chat model. Internal request/response format = the **Anthropic shape the codebase already builds** (separate `system`, content-block `messages`, `tools` with `input_schema`, `tool_choice`, `stop_reason`, `usage`), so existing call sites barely change.

- **`types.ts`** — `LlmProvider` interface + canonical types (aliased to Anthropic SDK types). Per-model capability descriptor: `{ supportsVision: boolean; toolReliability: 'high' | 'medium' }`.
- **`providers/anthropic.ts`** — wraps `@anthropic-ai/sdk`. Pass-through. Serves Claude, and first-party DeepSeek via its Anthropic-compatible endpoint (`https://api.deepseek.com/anthropic`) by base-URL swap.
- **`providers/openai-compat.ts`** — wraps the `openai` SDK. The only genuinely new logic: translate the Anthropic-shaped request → OpenAI Chat Completions and the response back. Mapping:
  - `system` block → leading `system` message
  - `tool_use` content block → assistant `tool_calls`; `tool_result` block → `tool`-role message keyed by `tool_call_id`
  - image content block → `image_url` part (only sent if the target model supports vision; otherwise the call is escalated, see below)
  - tool `input_schema` → function `parameters`; `tool_choice` `any`/`{tool}`/`auto` → `required`/`{function}`/`auto`
  - response `choices[0].message.tool_calls`/`content` → `tool_use`/`text` blocks; `finish_reason` → `stop_reason`; `usage.prompt_tokens`/`completion_tokens` → `input_tokens`/`output_tokens`
  - These translators are **pure functions, unit-tested** under `lib/**/*.test.ts` (the supported vitest scope) via TDD.
- **`registry.ts`** — maps a logical key → `{ provider, vendorModelId, capabilities }`. Keys: `claude-sonnet`, `claude-haiku`, `deepseek-flash`, `deepseek-pro`. DeepSeek hosting is env-driven (`DEEPSEEK_HOSTING`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL_FLASH/PRO`) so first-party ↔ Western host (Fireworks/OpenRouter/Azure Foundry) is a config change, never a code change. Default host = a Western, zero-retention endpoint for customer-data residency.
- **`index.ts`** — `createMessage(modelKey, params, opts)`: resolves provider, runs through the generalized resilience wrapper (`anthropic-resilient.ts` lifted to provider-agnostic `llm-resilient.ts`), applies capability-aware escalation, and emits cost telemetry.

## Capability-aware escalation (what makes default-DeepSeek safe)

Resolved inside `createMessage` before/around the provider call:

1. **Vision:** if the request contains image blocks and the selected model is `supportsVision:false` (DeepSeek — vision is unconfirmed in DeepSeek's own docs, so treated as unsupported), that call routes to the configured Claude model. No quality loss on image turns.
2. **Reliability:** if a DeepSeek call fails after retries, fall back to Claude once.
3. Every escalation is recorded (`fellBack: true`) so the escalation rate — and therefore the realized blended cost — is visible.

## Selection + rollout

- **Schema:** `Agent.model String @default('auto')` (hand-run SQL; existing rows backfill to `'auto'`).
  - `auto` → resolves to the platform default model (env `DEFAULT_AGENT_MODEL`, shipped initially as `claude-sonnet`, flipped to `deepseek-flash` when validated). This is the **fleet rollout switch**: one env change moves all `auto` agents, instantly reversible.
  - `claude-sonnet` → pin premium agents to Claude.
  - `deepseek-flash` / `deepseek-pro` → pin specific agents to DeepSeek.
- **Runtime:** `lib/ai-agent.ts:772` reads `agent.model` and calls `createMessage(resolvedKey, …)` instead of the hardcoded string.
- **Dashboard:** model picker on agent settings (mirrors the `judgeModel` dropdown), friendly labels: "Auto (platform default)", "Claude Sonnet 4 (best tool-use + vision)", "DeepSeek V4-Flash (lowest cost)", "DeepSeek V4-Pro (cheap frontier)". Ships with `<NewBadge>` + `FEATURE_SHIP_DATES` entry per repo convention.

## Prompt-cache-friendliness (cross-cutting, provider-agnostic win)

Restructure the agent system prompt to a **stable prefix + cache breakpoint**, dynamic content (RAG knowledge block, recent history) after it. Add Anthropic `cache_control` on the stable prefix; DeepSeek first-party and several Western hosts auto-cache a stable prefix. Cuts input cost ~10× on the cached portion regardless of which provider serves the turn.

## Cost telemetry (lands first)

The layer already receives `usage`. Persist per call: `{ model, provider, inputTokens, outputTokens, cachedInputTokens, fellBack }`. Populate `MessageLog.tokensUsed` + add a `model` column; optionally a small `LlmCall` rollup for dashboards. This is what makes "reduced cost" provable and tells us where spend actually concentrates.

## Phasing — ordered by dollar impact

- **Phase 0 — Measure + free win.** Cost telemetry on existing Anthropic calls; make the agent system prompt cache-friendly. No provider change yet; confirms the cost center and banks the caching saving.
- **Phase 1 — Provider layer + main agent.** Build `lib/llm/` + adapters + tests + escalation; migrate the main agent loop; add `Agent.model` + picker + `DEFAULT_AGENT_MODEL` switch. Validate DeepSeek vs Claude quality on real agents via the existing simulator/eval harness *before* flipping the switch. This phase delivers the headline saving.
- **Phase 2 — Opus + Sonnet backend.** Migrate the 4 Opus generators and Sonnet backend sites to the layer (DeepSeek or Sonnet). Easy, high-value.
- **Phase 3 — Haiku utilities.** Convert the ~12 already-cheap Haiku sites opportunistically. Lowest priority.

Each phase ships independently. "Full provider layer" is reached incrementally; Phase 1 is the core.

## Env vars (generated/configured, not handed to Ryan as commands)

`DEEPSEEK_HOSTING` (`firstparty`|`openai`), `DEEPSEEK_BASE_URL`, `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL_FLASH`, `DEEPSEEK_MODEL_PRO`, `DEFAULT_AGENT_MODEL` (start `claude-sonnet`). Set via `printf '%s' … | vercel env add` (never `echo`).

## Hand-run SQL (Ryan applies)

```sql
ALTER TABLE "Agent" ADD COLUMN "model" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "MessageLog" ADD COLUMN "model" TEXT;
```

## Testing

- OpenAI⇄Anthropic translation: vitest unit tests (TDD), pure functions.
- Tool-loop + vision-escalation + fallback paths: scenario harness.
- One live smoke call against the configured DeepSeek host before enabling any agent.
- Quality gate: simulator/eval comparison (DeepSeek vs Claude) on representative agents before flipping `DEFAULT_AGENT_MODEL`.

## Risks & mitigations

- **Quality regression on customer agents** → default `auto` resolves to Claude until the eval passes; flip is one env var, reversible.
- **Vision gap** → auto-escalate image turns to Claude.
- **Tool-loop reliability** (DeepSeek trails Claude on deep loops) → V4-Pro for deep agents; Claude fallback on failure; eval before rollout.
- **Uptime** (DeepSeek not SLA-grade) → Claude fallback; never single-homed.
- **Data residency** (first-party DeepSeek stores/​trains on data in China) → default to a Western zero-retention host via config.

## Out of scope

Streaming the main loop (stays non-streaming); the Gemini video/live-session path; Voyage embeddings. These aren't cost centers for this effort.
