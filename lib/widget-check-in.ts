/**
 * Auto "hey, are you still there?" check-in for widget conversations.
 *
 * Triggered by the stale-conversations cron when the agent's last
 * message has been sitting unanswered for STALE_MINUTES. We send ONE
 * brief, in-voice nudge so the visitor doesn't quietly abandon the chat
 * because they got distracted.
 *
 * Deliberately self-contained — does NOT go through runWidgetAgent's
 * full tool-loop. The agent has nothing to act on here, just one short
 * line to send. Bypassing the heavier path avoids reopening any of the
 * pause/handoff state machinery that has bitten us recently.
 *
 * Bounds we enforce so this can't spam:
 *   - Only fires when the LAST message is from the agent (matched by cron)
 *   - The cron stamps staleNotifiedAt so it can only fire once per quiet
 *     period; visitor reply clears the stamp
 *   - We skip when the agent has already sent a check-in-shaped message
 *     in the last 3 messages (heuristic keyword match)
 *   - Skipped for conversations with status != 'active'
 */

import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'
import { broadcast } from './widget-sse'

const client = new Anthropic()

// Keep the model fast + cheap — this is a one-line nudge, not a reasoning task.
const MODEL = 'claude-haiku-4-5-20251001'

// Heuristic keywords that suggest the agent already nudged. Avoids
// stacking "still there?" messages if the cron mis-fires across runs.
const ALREADY_NUDGED = [
  'still there',
  'still around',
  'still with me',
  'check in',
  'checking in',
  'are you there',
  'anyone still',
]

export async function sendQuietCheckIn(conversationId: string): Promise<{ sent: boolean; reason?: string }> {
  const convo = await db.widgetConversation.findUnique({
    where: { id: conversationId },
    include: {
      widget: { select: { name: true, primaryColor: true } },
      visitor: { select: { name: true } },
    },
  })
  if (!convo) return { sent: false, reason: 'not_found' }
  if (convo.status !== 'active') return { sent: false, reason: `status_${convo.status}` }

  // Load the last few turns to ground the model in tone + context.
  // 8 is enough to read the rapport without burning tokens; the model
  // isn't reasoning here, just matching voice.
  const recent = await db.widgetMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: 8,
    select: { role: true, content: true },
  })
  if (recent.length === 0) return { sent: false, reason: 'empty' }

  // Skip if a recent agent message looks like a check-in already.
  const recentAgent = recent.filter(m => m.role === 'agent').slice(0, 3)
  const alreadyNudged = recentAgent.some(m => {
    const c = (m.content || '').toLowerCase()
    return ALREADY_NUDGED.some(k => c.includes(k))
  })
  if (alreadyNudged) return { sent: false, reason: 'already_nudged' }

  const visitorName = convo.visitor?.name?.trim() || ''
  // Newest-last for the prompt so it reads naturally.
  const transcript = recent.reverse().map(m => {
    const who = m.role === 'agent' ? 'You' : m.role === 'visitor' ? (visitorName || 'Visitor') : 'System'
    return `${who}: ${m.content}`
  }).join('\n')

  let reply: string | null = null
  try {
    const completion = await client.messages.create({
      model: MODEL,
      max_tokens: 80,
      system:
        'You are checking back in on a live-chat conversation where the visitor went quiet ' +
        '10+ minutes ago after your last reply. Write ONE brief, friendly check-in (15 words max) ' +
        'in the same tone as your prior messages. Examples: "Still with me?", "Just checking in — ' +
        'did that help?", "Hey, are you still around?". DO NOT repeat the prior question verbatim. ' +
        'DO NOT introduce a new sales pitch or ask for an email. Output ONLY the message text — ' +
        'no quotes, no commentary, no preamble.',
      messages: [
        { role: 'user', content: `Recent transcript:\n\n${transcript}\n\nSend a brief check-in.` },
      ],
    })
    const block = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    reply = (block?.text || '').trim().replace(/^["']|["']$/g, '').slice(0, 200)
  } catch (err: any) {
    console.warn('[check-in] Claude call failed for', conversationId, err?.message)
    return { sent: false, reason: 'llm_failed' }
  }

  if (!reply) return { sent: false, reason: 'empty_reply' }

  // Persist as a real WidgetMessage so it's in the transcript and shows
  // on refresh; SSE broadcast so the open widget sees it instantly.
  const msg = await db.widgetMessage.create({
    data: { conversationId, role: 'agent', content: reply, kind: 'text' },
  })
  await db.widgetConversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: new Date() },
  })
  await broadcast(conversationId, {
    type: 'agent_message',
    id: msg.id,
    content: reply,
    createdAt: msg.createdAt.toISOString(),
  }).catch(() => {})

  return { sent: true }
}
