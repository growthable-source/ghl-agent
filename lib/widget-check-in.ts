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

import { db } from './db'
import { broadcast } from './widget-sse'
import { createMessage } from './llm'

// Keep the model fast + cheap — this is a one-line nudge, not a reasoning task.
const MODEL = 'claude-haiku'

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
      // brandId is an existing column (safe); aiEnabled is queried
      // separately below so a pre-migration DB doesn't P2022 the whole
      // check-in pass.
      widget: { select: { name: true, primaryColor: true, brandId: true } },
      visitor: { select: { name: true } },
    },
  })
  if (!convo) return { sent: false, reason: 'not_found' }
  if (convo.status !== 'active') return { sent: false, reason: `status_${convo.status}` }

  // This check-in is an AI-generated message, so it must respect the
  // same AI-off gates as runWidgetAgent — otherwise a human-only widget
  // (or brand) would still emit "still there?" nudges under role
  // 'agent'. Both reads are wrapped so a missing column (pre-migration)
  // degrades to "enabled" rather than throwing, matching the sibling
  // enableQuietCheckIn gate below.
  try {
    const w = await db.chatWidget.findUnique({
      where: { id: convo.widgetId },
      select: { aiEnabled: true } as any,
    }) as { aiEnabled?: boolean } | null
    if (w?.aiEnabled === false) return { sent: false, reason: 'ai_disabled_on_widget' }
  } catch (err: any) {
    if (err?.code !== 'P2022' && !/column .* does not exist/i.test(err?.message ?? '')) throw err
  }
  const brandId = (convo.widget as { brandId?: string | null })?.brandId
  if (brandId) {
    try {
      const brand = await (db as any).brand.findUnique({ where: { id: brandId }, select: { aiEnabled: true } })
      if (brand && brand.aiEnabled === false) return { sent: false, reason: 'ai_disabled_on_brand' }
    } catch (err: any) {
      if (err?.code !== 'P2022' && !/column .* does not exist/i.test(err?.message ?? '')) throw err
    }
  }

  // Per-agent opt-out. Defaults to true at the column level so the
  // migration doesn't change behaviour, but operators can flip it off
  // in the agent settings page when check-ins don't fit their flow.
  // Wrapped in try/catch so the cron keeps working on databases that
  // haven't run the migration yet — degrades to "always on" rather
  // than failing the whole pass.
  if (convo.agentId) {
    try {
      const agent = await db.agent.findUnique({
        where: { id: convo.agentId },
        select: { enableQuietCheckIn: true } as any,
      }) as any
      if (agent && agent.enableQuietCheckIn === false) {
        return { sent: false, reason: 'disabled_on_agent' }
      }
    } catch (err: any) {
      if (err?.code !== 'P2022' && !/column .* does not exist/i.test(err?.message ?? '')) {
        // Re-throw anything other than missing-column — that's a real bug.
        throw err
      }
      // Column not migrated yet — fall through, treat as enabled.
    }
  }

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
    const completion = await createMessage(MODEL, {
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
    }, { surface: 'check_in' })
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
