# Prompt Caching Spec

Standard for every project that calls the Anthropic API. Drop this file into the repo (or reference it from CLAUDE.md) and hold all prompt-assembly code to it. The reference implementation is `ghl-agent` (commits `e05b4e4` + `5e4d62e` — the second one fixed the mistakes this spec exists to prevent).

**Why this exists:** we shipped "correct" cache breakpoints in Voxility in June 2026 and they were silently useless for a month — message-keyed RAG passages and `"recorded 3m ago"` age stamps sat inside the "stable" prefix, so every inbound message paid the 1.25× cache-write premium and read nothing. The markers were right; the architecture was wrong. This spec is architecture-first.

---

## 1. The one invariant

**Caching is a byte-exact prefix match.** The API renders the request as `tools → system → messages` and caches up to each `cache_control` breakpoint. One changed byte at position N invalidates everything at positions ≥ N. No amount of marker placement compensates for volatile bytes early in the prompt.

## 2. Classify every input before writing prompt code

Every string that flows into `tools`, `system`, or `messages` gets a stability class, and its class determines where it renders:

| Stability | Examples | Where it renders |
|---|---|---|
| Never changes | Core instructions, tool schemas, formatting rules | Front of prompt, before all breakpoints |
| Per-conversation | Contact name, calendar ID, persona, channel | Stable prefix (cached per conversation) |
| Per-turn | RAG passages, keyword-matched knowledge, relevance-flagged objectives, qualifying state, memory summaries | **After the last prefix breakpoint** |
| Per-request | Timestamps, age stamps ("3m ago", "2 hours ago"), UUIDs, random IDs | After the last breakpoint — or delete it |

The class that bites hardest is **per-turn masquerading as stable**: anything computed *from the incoming message* (retrieval, relevance scoring, intent-keyed blocks) is per-turn by definition, even though it looks like "knowledge context." Same for anything computed from the wall clock — an age stamp changes bytes every minute even when the underlying data didn't change.

## 3. Required architecture: the two-channel prompt builder

Prompt builders MUST return stable and volatile content separately, and the runner MUST render volatile content after the breakpoint. Don't return one concatenated string — that's how volatile content sneaks into the prefix.

```ts
// Builder contract
interface PromptResult {
  prompt: string           // conversation-stable only → cached prefix
  volatileContext: string  // message/clock-derived → after breakpoint
}

// Runner assembly
const createParams = {
  model,
  system: [
    { type: 'text', text: stablePrompt, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: volatileContext + dateBlock },   // uncached tail
  ],
  tools,
  messages,
}
```

Rules:

- **The system prompt is frozen per conversation.** No `new Date()`, no `Date.now()`-derived strings, no request IDs, no mode flags interpolated into the stable block. Current date/time goes at the very end of the volatile tail.
- **Retrieval output is volatile.** RAG blocks, keyword knowledge, and anything else keyed to the incoming message go in `volatileContext`, never in the base prompt string.
- **Ordering side effects must be re-asserted.** If moving a block to the tail breaks an "X overrides Y" relationship (e.g. vocabulary rules used to render after knowledge), add a one-line re-assertion in the tail rather than moving the volatile block back.
- **Deterministic serialization.** `JSON.stringify` over objects with stable key order; never iterate a `Set`/`Map` into prompt text; sort tool lists by a fixed order. Two renders of the same logical prompt must be byte-identical.
- **Don't swap tools or model mid-conversation.** Tools render at position 0 — adding, removing, or reordering one invalidates everything. Caches are model-scoped, so a model fallback is a full cache miss (acceptable in failure paths, never in routine routing).
- **Side calls reuse the parent prefix verbatim.** Summarizers, compactors, and subagents that fork off a conversation must copy the parent's `model` + `tools` + `system` exactly and append their extra content at the end, or they miss the parent's cache entirely.

## 4. Breakpoint placement (max 4 per request)

Standard layout for an agent loop — three breakpoints, one spare:

1. **Last tool definition** — gives the (large, stable) tool catalog its own cache entry that survives system-prompt changes.
2. **Last stable system block** — caches tools + system together for the conversation.
3. **Last content block of the newest user turn** — so loop iterations 2..N re-read the whole history from cache. Only convert simple string content; leave mixed tool blocks alone.
4. *(Optional, long agentic loops)* a moving breakpoint on the newest `tool_result` so appended tool turns aren't re-billed every iteration. Also required if a single turn can append >20 content blocks — a breakpoint only looks back 20 blocks to find the previous cache entry.

For one-shot pipelines (classifiers, generators with a big shared system prompt), one breakpoint on the system block is enough. For shared-prefix/varying-question patterns, the breakpoint goes at the end of the *shared* part — never after the varying question, or every request writes a cache nothing reads.

**Minimum cacheable prefix is model-dependent** (silently uncached below it — no error): 1024 tokens on Sonnet ≤4.5; 2048 on Fable 5 / Sonnet 4.6; 4096 on Opus 4.5+ and Haiku 4.5. A marker on a 500-token prompt does nothing; that's fine (no premium is charged either), just don't expect reads.

**Known cheap invalidators to accept knowingly:** changing `tool_choice` between iterations preserves the tools+system cache but invalidates the messages tier. Fine when deliberate (forced first-turn tool calls); just know it costs one history re-bill.

## 5. Multi-provider layers

If a provider-abstraction layer can route the same request shape to non-Anthropic models, the translator MUST strip `cache_control` from tools, system blocks, and message content when targeting other providers. Carry it as an optional passthrough field (`cache_control?: unknown`) in the layer's types; only the Anthropic serializer forwards it.

## 6. Telemetry and verification (non-negotiable)

Caching that isn't measured is caching that silently broke — ours did, for a month.

- **Record `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens`** on every call, aggregated wherever you track spend (per-day, per-surface).
- **Healthy signature:** on multi-turn traffic, reads ≫ writes (steady state roughly ≥5:1). **Broken signature:** writes tracking request volume with near-zero reads — that means a per-request invalidator is inside the prefix; diff the rendered bytes of two consecutive requests to find it.
- Total prompt size = `input_tokens + cache_creation + cache_read`. `input_tokens` alone is only the uncached remainder — don't misread a small value as a small prompt.
- **Economics for judgment calls:** reads ≈ 0.1× base input; writes 1.25× (5-min TTL) or 2× (1-hour TTL). 5-min TTL breaks even at two requests. Use 1-hour TTL only for bursty traffic with gaps longer than 5 minutes between requests.

## 7. Review checklist

Before merging any change that touches prompt assembly:

- [ ] Every new prompt input classified (§2) and rendered in the right zone
- [ ] No `Date`/`now`/duration-formatting call feeds the stable prefix (grep the builder for `Date`, `now(`, `toLocale`, `ago`)
- [ ] No UUID/request-ID/random value ahead of the last breakpoint
- [ ] No conditional block in the stable prefix keyed to per-turn state
- [ ] Tool list byte-stable across a conversation (same set, same order, same schemas)
- [ ] Builders return `{ prompt, volatileContext }`, not a merged string
- [ ] Non-Anthropic serializers strip `cache_control`
- [ ] Cache usage counters recorded; check the read:write ratio after deploy — the deploy isn't "done" until reads dominate

---

*Reference: Anthropic prompt-caching docs (platform.claude.com/docs/en/build-with-claude/prompt-caching). Reference implementation: `ghl-agent/lib/ai-agent.ts`, `lib/agent/build-base-prompt.ts`, `lib/crm-inbound-prompt.ts`.*
