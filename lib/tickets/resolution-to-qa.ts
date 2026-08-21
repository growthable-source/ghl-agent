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
