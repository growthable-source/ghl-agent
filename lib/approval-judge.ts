/**
 * AI Judge — pre-screen draft replies that the rules engine has flagged
 * for human approval.
 *
 * The judge is a small LLM (Haiku by default) given a tight rubric:
 * does this reply look safe to send, look unsafe, or look uncertain?
 * Verdicts:
 *   safe       → optionally auto-release (operator opts in per-agent)
 *   unsafe     → optionally auto-reject  (operator opts in per-agent)
 *   uncertain  → leave in the human approval queue
 *
 * Cost note: Haiku is ~30× cheaper than Sonnet, so this typically pays for
 * itself the first hour by removing routine "this is fine" reviews from
 * the operator's plate.
 */

import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type JudgeVerdict = 'safe' | 'unsafe' | 'uncertain'

export interface JudgeInput {
  inboundMessage: string
  draftReply: string
  agentSystemPrompt?: string | null
  approvalReason?: string | null
  judgeInstructions?: string | null
  model?: 'haiku' | 'sonnet'
}

export interface JudgeOutput {
  verdict: JudgeVerdict
  reason: string
  model: string
  latencyMs: number
}

const MODEL_IDS: Record<'haiku' | 'sonnet', string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-20250514',
}

const SYSTEM_PROMPT = `You are a safety reviewer for an AI agent's draft reply before it's sent to a real person via SMS, email, or chat.

Verdict options (return EXACTLY one):
  SAFE       — the reply is appropriate, accurate-sounding, and doesn't make commitments the agent can't keep
  UNSAFE     — the reply is harmful, misleading, makes a fake claim, leaks data, or violates the rubric
  UNCERTAIN  — close call; needs a human to decide

Common SAFE patterns: greetings, scheduling questions, confirming details that the inbound supplied, light qualification.
Common UNSAFE patterns: false promises (refunds without authority, guaranteed outcomes), made-up data (specific stats / pricing not in the rubric), aggressive sales pressure, anything political/legal, anything that quotes a price the agent shouldn't quote.
When in doubt — UNCERTAIN.

Reply with this EXACT format on a single line:
VERDICT: <SAFE|UNSAFE|UNCERTAIN> | REASON: <one sentence, ≤120 chars>`

export async function judgeReply(input: JudgeInput): Promise<JudgeOutput> {
  const modelKey = input.model || 'haiku'
  const model = MODEL_IDS[modelKey]
  const startedAt = Date.now()

  const userContent = [
    input.judgeInstructions ? `Operator's custom rubric:\n${input.judgeInstructions}\n` : '',
    input.agentSystemPrompt ? `Agent's job description:\n${input.agentSystemPrompt.slice(0, 2000)}\n` : '',
    input.approvalReason ? `Why this was flagged: ${input.approvalReason}\n` : '',
    `Inbound from contact:\n"${input.inboundMessage}"\n`,
    `Draft reply from the agent:\n"${input.draftReply}"`,
  ].filter(Boolean).join('\n')

  let raw: string
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 120,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })
    const text = res.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined
    raw = text?.text || ''
  } catch (err: any) {
    // Network/API error — fail open, leave in queue for human review
    return {
      verdict: 'uncertain',
      reason: `Judge call failed: ${err.message?.slice(0, 80) || 'unknown error'}`,
      model,
      latencyMs: Date.now() - startedAt,
    }
  }

  return { ...parseVerdict(raw), model, latencyMs: Date.now() - startedAt }
}

function parseVerdict(text: string): { verdict: JudgeVerdict; reason: string } {
  const m = text.match(/VERDICT:\s*(SAFE|UNSAFE|UNCERTAIN)\s*\|\s*REASON:\s*(.+)/i)
  if (m) {
    const verdict = m[1].toLowerCase() as JudgeVerdict
    return { verdict, reason: m[2].trim().slice(0, 200) }
  }
  // Loose fallback
  const upper = text.toUpperCase()
  if (upper.includes('UNSAFE')) return { verdict: 'unsafe', reason: text.slice(0, 200) }
  if (upper.includes('SAFE') && !upper.includes('UNSAFE')) return { verdict: 'safe', reason: text.slice(0, 200) }
  return { verdict: 'uncertain', reason: text.slice(0, 200) || 'Unparseable judge response' }
}
