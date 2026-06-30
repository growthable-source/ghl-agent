/**
 * Shared operator-facing conversation summary generator.
 *
 * Single source of truth for the Haiku summary used in three places:
 *   - the inbox AI-summary panel (on-demand, via the summary route)
 *   - when a chat ENDS (auto-generated so it's ready next time)
 *   - when a conversation is promoted to a ticket (stamped on the ticket)
 *
 * Caches the result on WidgetConversation.aiSummary/aiSummaryAt.
 * Best-effort persistence — tolerates the columns being absent on a
 * pre-migration DB so callers never throw on summary work.
 */

import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'

const client = new Anthropic()
const MODEL = 'claude-haiku-4-5'

const SUMMARY_SYSTEM =
  'Summarise this live-chat transcript for an operator scanning the inbox. ' +
  'Three short bullets max, each <15 words: (1) what the visitor wanted, ' +
  '(2) what was answered or attempted, (3) the current status / open question. ' +
  'Use plain text. No "Bullet:" prefixes. No preamble. If there is nothing yet, ' +
  'output a single line saying so.'

const FRESH_MS = 2 * 60_000

function isMissingColumn(err: any): boolean {
  return err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')
}

/**
 * Generate (and cache) a summary for a conversation. Returns null when
 * there's nothing to summarise or the model call fails. With
 * `force: false` (default) a summary younger than 2 minutes is reused.
 */
export async function generateConversationSummary(
  conversationId: string,
  opts: { force?: boolean } = {},
): Promise<{ summary: string; summaryAt: Date } | null> {
  if (!opts.force) {
    try {
      const existing = await (db as any).widgetConversation.findUnique({
        where: { id: conversationId },
        select: { aiSummary: true, aiSummaryAt: true },
      })
      if (existing?.aiSummary && existing?.aiSummaryAt) {
        const ageMs = Date.now() - new Date(existing.aiSummaryAt).getTime()
        if (ageMs < FRESH_MS) return { summary: existing.aiSummary, summaryAt: new Date(existing.aiSummaryAt) }
      }
    } catch {
      /* columns missing — fall through to generate */
    }
  }

  const messages = await db.widgetMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { role: true, content: true, kind: true },
  })
  if (messages.length === 0) return null

  const transcript = messages
    .filter(m => m.kind === 'text' || !m.kind)
    .map(m => `${m.role === 'agent' ? 'Agent' : m.role === 'visitor' ? 'Visitor' : 'System'}: ${m.content}`)
    .join('\n')
    .slice(0, 12_000)
  if (!transcript.trim()) return null

  let summary = ''
  try {
    const completion = await client.messages.create({
      model: MODEL,
      max_tokens: 220,
      system: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: transcript }],
    })
    const block = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    summary = (block?.text || '').trim()
  } catch {
    return null
  }
  if (!summary) return null

  const now = new Date()
  try {
    await (db as any).widgetConversation.update({
      where: { id: conversationId },
      data: { aiSummary: summary, aiSummaryAt: now },
    })
  } catch (err: any) {
    if (!isMissingColumn(err)) throw err
  }
  return { summary, summaryAt: now }
}
