/**
 * Pure helpers for conversation Q&A mining — no DB / network / LLM imports, so
 * they're unit-testable in isolation (see conversation-mining-utils.test.ts).
 * The orchestration that uses these lives in lib/conversation-mining.ts.
 */

import { createHash } from 'node:crypto'
import type { Message } from '@/types'

// Conversational text channels worth mining. Calls/activities/internal
// comments carry no reusable Q&A and would just burn tokens.
export const TEXT_TYPES = new Set([
  'TYPE_SMS', 'TYPE_EMAIL', 'TYPE_LIVE_CHAT', 'TYPE_WHATSAPP',
  'TYPE_FACEBOOK', 'TYPE_INSTAGRAM', 'TYPE_GMB',
])

// messageSource values that mean the outbound was machine-sent, not a human
// support reply. Used to drop automated outbound from the transcript.
export const AUTOMATED_SOURCES = new Set(['workflow', 'bulk_actions', 'campaign', 'api', 'bot'])

export const TRANSCRIPT_CHAR_CAP = 6000

/** Normalize a question for dedup — lowercase, collapse whitespace, drop trailing punctuation. */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[?.!,;:]+$/g, '').trim()
}

export function questionHash(q: string): string {
  return createHash('md5').update(normalizeQuestion(q)).digest('hex')
}

/** True when a message is an outbound reply a human team member sent (not automation). */
export function isHumanOutbound(m: Message): boolean {
  if (m.direction !== 'outbound') return false
  if (!m.sentByUserId) return false
  if (m.messageSource && AUTOMATED_SOURCES.has(m.messageSource)) return false
  return true
}

function msgTime(m: Message): number {
  return Date.parse(m.dateAdded ?? m.createdAt ?? '') || 0
}

/**
 * Build a chronological "[Customer] / [Agent]" transcript for one
 * conversation, keeping only text channels. Returns null when there's no
 * human answer in the thread (nothing to learn from). Automated outbound is
 * dropped entirely.
 */
export function buildTranscript(messages: Message[]): string | null {
  const text = messages
    .filter(m => !m.messageType || TEXT_TYPES.has(m.messageType))
    .filter(m => (m.body ?? '').trim().length > 0)
    .sort((a, b) => msgTime(a) - msgTime(b))

  if (!text.some(isHumanOutbound)) return null

  const lines: string[] = []
  for (const m of text) {
    if (m.direction === 'inbound') {
      lines.push(`[Customer]: ${m.body.trim()}`)
    } else if (isHumanOutbound(m)) {
      lines.push(`[Agent]: ${m.body.trim()}`)
    }
  }
  const joined = lines.join('\n')
  return joined.length > TRANSCRIPT_CHAR_CAP ? joined.slice(-TRANSCRIPT_CHAR_CAP) : joined
}
