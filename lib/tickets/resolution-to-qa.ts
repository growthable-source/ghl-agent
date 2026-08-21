/**
 * Distil a released support reply into a reusable, PII-stripped Q&A pair —
 * the "interaction → Brand-Only Knowledge" step of the approval-learning loop.
 *
 * The pure pieces (`buildResolutionQaPrompt`, `parseResolutionQa`) are
 * unit-tested; `distillResolutionToQa` wraps them around one cheap LLM call
 * and ALWAYS degrades to a raw pair so the caller never loses a learning to a
 * model hiccup. The result is only ever STAGED (MinedQaPair) for human review,
 * so a rough fallback is safe.
 */

import { createMessage } from '@/lib/llm'
import type { LlmContentBlock } from '@/lib/llm/types'

export interface ResolutionQa {
  question: string
  answer: string
}

export interface DistilledResolution extends ResolutionQa {
  /** Model self-confidence proxy: 0.7 when the LLM produced a clean pair,
   *  0.3 for the raw fallback (nudges reviewers to eyeball it). */
  confidence: number
  /** True when the LLM distilled it; false when we fell back to raw text. */
  distilled: boolean
}

const SYSTEM = `You turn a single resolved support exchange into ONE reusable FAQ pair that will help an AI assistant answer the SAME question for a FUTURE customer.

Rules:
- Rewrite the customer's question into a clean, general form. Strip the specific person's name, email, phone, order/account numbers, addresses, and any other personal data — from BOTH the question and the answer.
- The answer must be the business's actual, self-contained answer, generalized. Drop the greeting, the sign-off, and anything specific to this one customer.
- If the reply is purely a greeting, a "let me check", or otherwise not a reusable answer, still return your best general Q&A — a human reviews it before it goes live.
- Reply with ONLY a JSON object, no prose, no code fence:
{"question": "<general question>", "answer": "<general answer>"}`

export function buildResolutionQaPrompt(input: {
  question: string
  reply: string
  brandName?: string | null
}): { system: string; user: string } {
  const brandLine = input.brandName ? `Brand: ${input.brandName}\n\n` : ''
  const user = `${brandLine}Customer asked:\n"""\n${input.question.trim()}\n"""\n\nThe reply that was sent:\n"""\n${input.reply.trim()}\n"""`
  return { system: SYSTEM, user }
}

/**
 * Pull a {question, answer} pair out of the model's text. Tolerant of code
 * fences and surrounding prose: grabs the first balanced-looking JSON object
 * and validates both fields are non-empty strings. Returns null otherwise.
 */
export function parseResolutionQa(raw: string): ResolutionQa | null {
  if (!raw) return null
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  let obj: unknown
  try {
    obj = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  const question = typeof rec.question === 'string' ? rec.question.trim() : ''
  const answer = typeof rec.answer === 'string' ? rec.answer.trim() : ''
  if (!question || !answer) return null
  return { question, answer }
}

// ── Live-chat transcript → Q&A ──────────────────────────────────────────
// A highly-rated chat isn't one question + one reply; it's a multi-turn
// exchange. We ask the model for the single most reusable Q&A in it.

const TRANSCRIPT_SYSTEM = `You read a resolved customer-support CHAT transcript that the customer rated highly, and extract the ONE most reusable FAQ pair that would help an AI assistant answer the SAME question for a FUTURE customer.

Rules:
- Pick the customer's main question and the answer that actually resolved it. Ignore greetings, small talk, and scheduling back-and-forth.
- Rewrite the question into a clean, general form. Strip names, emails, phone numbers, order/account numbers, addresses — from BOTH question and answer.
- The answer must be the business's actual, self-contained answer, generalized.
- If the chat has no reusable Q&A (pure chit-chat, unresolved, or too thin), return {"question":"","answer":""}.
- Reply with ONLY a JSON object, no prose, no code fence:
{"question": "<general question>", "answer": "<general answer>"}`

/** Turn ordered chat messages into a compact CUSTOMER/AGENT transcript.
 *  Pure + testable; caps length so the prompt stays cheap. Drops
 *  non-conversational turns — operator system notes (role 'system') and
 *  non-text cards (kind != 'text', e.g. product-card JSON) — so internal text
 *  and raw JSON never reach the distiller. */
export function formatChatTranscript(
  messages: Array<{ role: string; content: string; kind?: string | null }>,
  opts: { maxMessages?: number; maxChars?: number } = {},
): string {
  const maxMessages = opts.maxMessages ?? 40
  const maxChars = opts.maxChars ?? 6000
  const lines: string[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.kind && m.kind !== 'text') continue
    const text = (m.content ?? '').trim()
    if (!text) continue
    const who = m.role === 'visitor' || m.role === 'user' || m.role === 'contact' ? 'CUSTOMER' : 'AGENT'
    lines.push(`${who}: ${text}`)
  }
  const recent = lines.slice(-maxMessages)
  const joined = recent.join('\n')
  return joined.length > maxChars ? joined.slice(joined.length - maxChars) : joined
}

export function buildTranscriptQaPrompt(input: {
  transcript: string
  brandName?: string | null
}): { system: string; user: string } {
  const brandLine = input.brandName ? `Brand: ${input.brandName}\n\n` : ''
  return {
    system: TRANSCRIPT_SYSTEM,
    user: `${brandLine}Chat transcript:\n"""\n${input.transcript.trim()}\n"""`,
  }
}

/**
 * Distil the best reusable Q&A from a rated chat. Returns null when the model
 * finds nothing reusable or the call fails — the caller then simply doesn't
 * stage a learning (unlike the ticket path there's no sensible raw fallback
 * for a whole transcript).
 */
export async function distillTranscriptToQa(input: {
  transcript: string
  brandName?: string | null
}): Promise<DistilledResolution | null> {
  if (input.transcript.trim().length < 20) return null
  const { system, user } = buildTranscriptQaPrompt(input)
  try {
    const res = await createMessage(
      'claude-haiku',
      { max_tokens: 500, temperature: 0, system, messages: [{ role: 'user', content: user }] },
      { surface: 'chat_csat_qa' },
    )
    const text = res.content.find(b => b.type === 'text') as (LlmContentBlock & { text: string }) | undefined
    const parsed = parseResolutionQa(text?.text ?? '')
    if (parsed) return { ...parsed, confidence: 0.7, distilled: true }
  } catch {
    /* nothing reusable / call failed → skip */
  }
  return null
}

export async function distillResolutionToQa(input: {
  question: string
  reply: string
  brandName?: string | null
}): Promise<DistilledResolution> {
  const rawFallback: DistilledResolution = {
    question: input.question.trim().slice(0, 2000),
    answer: input.reply.trim(),
    confidence: 0.3,
    distilled: false,
  }
  // Nothing worth a model call — the customer message is too thin to
  // generalize. Stage the raw pair for review.
  if (input.question.trim().length < 4 || input.reply.trim().length < 4) {
    return rawFallback
  }

  const { system, user } = buildResolutionQaPrompt(input)
  try {
    const res = await createMessage(
      'claude-haiku',
      {
        max_tokens: 500,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: user }],
      },
      { surface: 'ticket_resolution_qa' },
    )
    const text = res.content.find(b => b.type === 'text') as (LlmContentBlock & { text: string }) | undefined
    const parsed = parseResolutionQa(text?.text ?? '')
    if (parsed) return { ...parsed, confidence: 0.7, distilled: true }
  } catch {
    // fall through to raw
  }
  return rawFallback
}
