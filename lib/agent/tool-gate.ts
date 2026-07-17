/**
 * Enforced-tool gate (Phase B3).
 *
 * For tools flagged `enforcement: 'enforced'` in the catalog, this module
 * runs a small Haiku check before dispatch: "Given this conversation + this
 * rule + this proposed tool input, does it satisfy the rule?" — answers
 * ALLOW or BLOCK with a one-line reason.
 *
 * Fail-open on errors (timeout, network, parse failure) — don't punish the
 * user for our own gate infrastructure failing. Every check is logged to
 * the ToolGateDecision table regardless of outcome.
 *
 * Skipped at the call-site when:
 *   - sandbox run (production safety only)
 *   - agent's toolAutonomyMode is 'autonomous'
 *   - resolved useWhen is empty (no rule = nothing to enforce)
 *   - the tool's catalog `enforcement` !== 'enforced'
 */

import { db } from '@/lib/db'
import { createMessage, type LlmCreateParams } from '@/lib/llm'

const GATE_MODEL = 'claude-haiku'
const GATE_TIMEOUT_MS = 5000
const GATE_MAX_TOKENS = 120

/** createMessage bounded by the gate timeout. The race doesn't cancel the
 *  underlying HTTP call (the LLM layer owns no abort surface), but the gate
 *  fails open at the deadline either way — same posture as before, and the
 *  call now lands in LlmUsageDaily. */
function gateCall(params: LlmCreateParams, agentId: string) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    createMessage(GATE_MODEL, params, { surface: 'tool_gate', agentId }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`gate timed out after ${GATE_TIMEOUT_MS}ms`)), GATE_TIMEOUT_MS)
    }),
  ]).finally(() => clearTimeout(timer))
}

export interface GateInput {
  agentId: string
  conversationId: string | null
  contactId: string | null
  toolName: string
  useWhen: string
  toolInput: Record<string, unknown>
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface GateDecision {
  allowed: boolean
  reason: string
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
}

const GATE_SYSTEM = `You are a strict gating layer for a sales/support AI agent. Given a conversation and a proposed tool call, decide whether the tool's "Use when" rule is satisfied.

Rules:
- If the rule is CLEARLY satisfied → ALLOW.
- If the rule is PARTIALLY satisfied but key prerequisites are missing → BLOCK.
- If the conversation doesn't provide enough evidence → BLOCK.
- Err toward BLOCK. Wrong actions cost more than missed actions.

Respond on a single line, in EXACTLY one of these formats:
ALLOW: <one-line reason>
BLOCK: <one-line reason explaining what's missing>`

// Batched variant: several proposed tool calls evaluated in ONE call, so the
// shared conversation history is sent once instead of per tool.
const GATE_SYSTEM_BATCH = `You are a strict gating layer for a sales/support AI agent. You will be given a conversation and SEVERAL proposed tool calls, each numbered and carrying its OWN "Use when" rule. Decide independently for EACH whether its rule is satisfied.

Rules:
- If a tool's rule is CLEARLY satisfied → ALLOW.
- If PARTIALLY satisfied but key prerequisites are missing → BLOCK.
- If the conversation doesn't provide enough evidence → BLOCK.
- Err toward BLOCK. Wrong actions cost more than missed actions.

Respond with EXACTLY one line per numbered item, in the SAME order, each line in one of these formats:
[N] ALLOW: <one-line reason>
[N] BLOCK: <one-line reason explaining what's missing>`

export async function runToolGate(input: GateInput): Promise<GateDecision> {
  const started = Date.now()

  const formattedHistory = input.recentMessages.slice(-10)
    .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 400) : '[non-text content]'}`)
    .join('\n')

  const userMessage = `Tool: ${input.toolName}
Rule: ${input.useWhen}
Tool input: ${JSON.stringify(input.toolInput).slice(0, 800)}

Recent conversation (last 10 turns):
${formattedHistory}

Decision?`

  let allowed = false
  let reason = ''
  let inputTokens: number | undefined
  let outputTokens: number | undefined

  try {
    const res = await gateCall({
      max_tokens: GATE_MAX_TOKENS,
      system: GATE_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
    }, input.agentId)
    inputTokens = res.usage.input_tokens
    outputTokens = res.usage.output_tokens
    const text = (res.content[0] as any)?.text ?? ''
    const parsed = parseGateResponse(text)
    allowed = parsed.allowed
    reason = parsed.reason
  } catch (err: any) {
    // FAIL-OPEN: don't block the user on our gate failing.
    console.warn(`[tool-gate] failure for ${input.toolName}, failing open:`, err?.message)
    allowed = true
    reason = `gate_failure: ${err?.message ?? 'unknown'}`
  }

  const latencyMs = Date.now() - started

  // Log decision (fire-and-forget — never let log failure block the agent)
  void db.toolGateDecision.create({
    data: {
      agentId: input.agentId,
      conversationId: input.conversationId,
      contactId: input.contactId,
      toolName: input.toolName,
      decision: allowed ? 'allowed' : 'blocked',
      reason: reason.slice(0, 500),
      latencyMs,
      inputTokens,
      outputTokens,
    },
  }).catch((err: any) => {
    console.warn(`[tool-gate] log failed:`, err?.message)
  })

  return { allowed, reason, latencyMs, inputTokens, outputTokens }
}

/**
 * Parse the Haiku response. Tolerant of leading whitespace + capitalisation
 * variants. Defaults to ALLOW with a "parse_failure" reason — fail-open on
 * unparseable responses too.
 */
export function parseGateResponse(text: string): { allowed: boolean; reason: string } {
  const trimmed = text.trim()
  const upper = trimmed.toUpperCase()
  if (upper.startsWith('BLOCK')) {
    const colonIdx = trimmed.indexOf(':')
    return {
      allowed: false,
      reason: colonIdx >= 0 ? trimmed.slice(colonIdx + 1).trim() : 'no reason given',
    }
  }
  if (upper.startsWith('ALLOW')) {
    const colonIdx = trimmed.indexOf(':')
    return {
      allowed: true,
      reason: colonIdx >= 0 ? trimmed.slice(colonIdx + 1).trim() : 'allowed',
    }
  }
  // Couldn't parse — fail open
  return { allowed: true, reason: `parse_failure: ${trimmed.slice(0, 100)}` }
}

// ─── Batched gate ──────────────────────────────────────────────────────────
// When one agent iteration proposes multiple enforced tool calls, evaluating
// each in its own Haiku call re-sends the whole conversation context N times.
// runToolGateBatch sends the shared history ONCE and gets one ALLOW/BLOCK per
// tool back — same decision semantics, a fraction of the tokens.

export interface BatchGateItem {
  /** Stable key for mapping the decision back — the tool_use block id. */
  id: string
  toolName: string
  useWhen: string
  toolInput: Record<string, unknown>
}

export interface BatchGateInput {
  agentId: string
  conversationId: string | null
  contactId: string | null
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  items: BatchGateItem[]
}

/**
 * Parse the batched response — one `[N] ALLOW/BLOCK: reason` line per item.
 * Tolerant of out-of-order lines and surrounding noise. Any item missing a
 * line fails OPEN (matches the single-tool gate's posture).
 */
export function parseBatchGateResponse(
  text: string,
  count: number,
): Array<{ allowed: boolean; reason: string }> {
  const byIndex = new Map<number, string>()
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const m = line.match(/^\[(\d+)\]\s*(.*)$/)
    if (m) {
      const idx = parseInt(m[1], 10) - 1
      if (idx >= 0 && !byIndex.has(idx)) byIndex.set(idx, m[2])
    }
  }
  const out: Array<{ allowed: boolean; reason: string }> = []
  for (let i = 0; i < count; i++) {
    const body = byIndex.get(i)
    out.push(body == null
      ? { allowed: true, reason: `parse_failure: missing decision for item ${i + 1}` }
      : parseGateResponse(body))
  }
  return out
}

export async function runToolGateBatch(input: BatchGateInput): Promise<Map<string, GateDecision>> {
  const out = new Map<string, GateDecision>()
  if (input.items.length === 0) return out

  const started = Date.now()

  const formattedHistory = input.recentMessages.slice(-10)
    .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 400) : '[non-text content]'}`)
    .join('\n')

  const itemsBlock = input.items
    .map((it, i) => `[${i + 1}] Tool: ${it.toolName}
Rule: ${it.useWhen}
Tool input: ${JSON.stringify(it.toolInput).slice(0, 800)}`)
    .join('\n\n')

  const userMessage = `Recent conversation (last 10 turns):
${formattedHistory}

Evaluate each proposed tool call below against ITS OWN rule:

${itemsBlock}

Decisions (one line per item, in order)?`

  let decisions: Array<{ allowed: boolean; reason: string }> = []
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let failOpenReason: string | null = null

  try {
    const res = await gateCall({
      // Each verdict is one short line; scale the budget with item count
      // but cap it so a runaway response can't balloon cost.
      max_tokens: Math.min(GATE_MAX_TOKENS * input.items.length, 600),
      system: GATE_SYSTEM_BATCH,
      messages: [{ role: 'user', content: userMessage }],
    }, input.agentId)
    inputTokens = res.usage.input_tokens
    outputTokens = res.usage.output_tokens
    const text = (res.content[0] as any)?.text ?? ''
    decisions = parseBatchGateResponse(text, input.items.length)
  } catch (err: any) {
    // FAIL-OPEN: don't block the user on our gate failing.
    console.warn(`[tool-gate] batch failure for ${input.items.length} tool(s), failing open:`, err?.message)
    failOpenReason = `gate_failure: ${err?.message ?? 'unknown'}`
  }

  const latencyMs = Date.now() - started

  input.items.forEach((it, i) => {
    const d = (!failOpenReason && decisions[i]) ? decisions[i] : { allowed: true, reason: failOpenReason ?? 'gate_failure: unknown' }
    // One LLM call covers every item — attribute its tokens to the first
    // row only so SUM(inputTokens) across the rows equals the real spend.
    const rowInput = i === 0 ? inputTokens : 0
    const rowOutput = i === 0 ? outputTokens : 0
    out.set(it.id, { allowed: d.allowed, reason: d.reason, latencyMs, inputTokens: rowInput, outputTokens: rowOutput })

    // Log one decision row per tool (fire-and-forget), preserving the
    // single-tool gate's audit trail.
    void db.toolGateDecision.create({
      data: {
        agentId: input.agentId,
        conversationId: input.conversationId,
        contactId: input.contactId,
        toolName: it.toolName,
        decision: d.allowed ? 'allowed' : 'blocked',
        reason: d.reason.slice(0, 500),
        latencyMs,
        inputTokens: rowInput,
        outputTokens: rowOutput,
      },
    }).catch((err: any) => {
      console.warn(`[tool-gate] batch log failed:`, err?.message)
    })
  })

  return out
}

/**
 * Resolve whether a tool should be gated for this agent, and its useWhen
 * rule. Shared by the batched loop-level pre-pass and kept in sync with the
 * inline gate in executeTool. Fail-open (returns shouldGate:false) on any
 * resolution error so gate infrastructure can't break dispatch.
 */
export async function resolveEnforcedGate(
  agentId: string,
  toolName: string,
  autonomyMode: string,
): Promise<{ shouldGate: boolean; useWhen: string }> {
  try {
    if (autonomyMode !== 'guided') return { shouldGate: false, useWhen: '' }
    const { AGENT_TOOLS: catalog } = await import('./tool-catalog')
    const catalogEntry = (catalog as any[]).find((t: any) => t.name === toolName)
    if (catalogEntry?.enforcement !== 'enforced') return { shouldGate: false, useWhen: '' }
    const { resolveOneToolConfig } = await import('./tool-config')
    const cfg = await resolveOneToolConfig(agentId, toolName)
    const useWhen = cfg.useWhen ?? ''
    return { shouldGate: useWhen.length > 0, useWhen }
  } catch {
    return { shouldGate: false, useWhen: '' }
  }
}
