/**
 * Live-chat conduct/sentiment traffic light.
 *
 * Classifies the CUSTOMER's conduct in a chat as green / amber / red so the
 * team can spot — and stop — abuse. Runs a cheap Haiku call over the visitor's
 * recent messages on each inbound message; the pure prompt/parse helpers are
 * unit-tested. Best-effort: never blocks or breaks the chat.
 *
 * Deliberately advisory only — a red score NEVER auto-blocks anyone. Blocking
 * is a human action (see the portal moderation route); the meter just surfaces
 * who to look at.
 */

import { db } from '@/lib/db'
import { createMessage } from '@/lib/llm'
import type { LlmContentBlock } from '@/lib/llm/types'

export type SentimentLevel = 'green' | 'amber' | 'red'

const SYSTEM = `You rate how the CUSTOMER is behaving in a customer-support chat — their conduct only, not whether their problem is solved.

Levels (return EXACTLY one):
  GREEN — polite, neutral, friendly, or simply asking for help
  AMBER — clearly frustrated, curt, or negative, but still civil
  RED   — rude, insulting, aggressive, threatening, harassing, sexually explicit, or using slurs / discriminatory language

Judge ONLY the customer's messages. Being unhappy about a product is not RED; personal abuse, threats, slurs, or hostility toward the person helping them IS.

Reply on a single line, EXACTLY:
LEVEL: <GREEN|AMBER|RED> | REASON: <one short sentence, ≤120 chars>`

export function buildSentimentPrompt(transcript: string): { system: string; user: string } {
  return { system: SYSTEM, user: `The customer's recent messages:\n"""\n${transcript.trim()}\n"""` }
}

export function parseSentiment(raw: string): { level: SentimentLevel; reason: string } | null {
  if (!raw) return null
  const m = raw.match(/LEVEL:\s*(GREEN|AMBER|RED)\s*\|\s*REASON:\s*(.+)/i)
  if (m) {
    return { level: m[1].toLowerCase() as SentimentLevel, reason: m[2].trim().slice(0, 200) }
  }
  // Loose fallback — worst level present wins so abuse is never softened.
  // Word-boundary matching so "answe(RED)", "offe(RED)", "orde(RED)" etc. don't
  // falsely trip RED on a benign reason.
  const upper = raw.toUpperCase()
  if (/\bRED\b/.test(upper)) return { level: 'red', reason: raw.trim().slice(0, 200) }
  if (/\bAMBER\b/.test(upper)) return { level: 'amber', reason: raw.trim().slice(0, 200) }
  if (/\bGREEN\b/.test(upper)) return { level: 'green', reason: raw.trim().slice(0, 200) }
  return null
}

/**
 * Classify a conversation from its recent visitor messages and store the
 * result on the WidgetConversation. Best-effort; swallows everything.
 */
export async function classifyConversationSentiment(conversationId: string): Promise<void> {
  try {
    const messages = await db.widgetMessage.findMany({
      where: { conversationId, role: { in: ['visitor', 'user', 'contact'] } },
      orderBy: { createdAt: 'desc' },
      take: 12,
      select: { content: true },
    })
    const transcript = messages
      .reverse()
      .map(m => (m.content ?? '').trim())
      .filter(Boolean)
      .join('\n')
      .slice(-4000)
    if (transcript.length < 3) return

    const { system, user } = buildSentimentPrompt(transcript)
    const res = await createMessage(
      'claude-haiku',
      { max_tokens: 120, temperature: 0, system, messages: [{ role: 'user', content: user }] },
      { surface: 'widget_sentiment' },
    )
    const text = res.content.find(b => b.type === 'text') as (LlmContentBlock & { text: string }) | undefined
    const parsed = parseSentiment(text?.text ?? '')
    if (!parsed) return

    await db.widgetConversation.update({
      where: { id: conversationId },
      data: { sentiment: parsed.level, sentimentReason: parsed.reason, sentimentUpdatedAt: new Date() },
    }).catch(() => {}) // pre-migration column / deleted convo
  } catch {
    /* best-effort */
  }
}
