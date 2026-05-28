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

import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'

const GATE_MODEL = 'claude-haiku-4-5-20250929'
const GATE_TIMEOUT_MS = 5000
const GATE_MAX_TOKENS = 120

const gateClient = new Anthropic()

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
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), GATE_TIMEOUT_MS)
    try {
      const res = await gateClient.messages.create(
        {
          model: GATE_MODEL,
          max_tokens: GATE_MAX_TOKENS,
          system: GATE_SYSTEM,
          messages: [{ role: 'user', content: userMessage }],
        },
        { signal: controller.signal as any },
      )
      inputTokens = res.usage.input_tokens
      outputTokens = res.usage.output_tokens
      const text = (res.content[0] as any)?.text ?? ''
      const parsed = parseGateResponse(text)
      allowed = parsed.allowed
      reason = parsed.reason
    } finally {
      clearTimeout(timeoutId)
    }
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
