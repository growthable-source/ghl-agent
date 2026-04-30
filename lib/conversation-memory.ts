import { db } from './db'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

// Reserved roles that are persisted to ConversationMessage but excluded from
// the chat history shown to the model. They carry structured context that
// the prompt builder lifts into dedicated blocks instead.
export const OFFERED_SLOTS_ROLE = '__offered_slots__'
export const CLEARED_OFFERED_SLOTS_ROLE = '__offered_slots_cleared__'

export async function saveMessages(
  agentId: string,
  locationId: string,
  contactId: string,
  conversationId: string,
  messages: Array<{ role: string; content: string }>
) {
  await db.conversationMessage.createMany({
    data: messages.map(m => ({ agentId, locationId, contactId, conversationId, role: m.role, content: m.content })),
  })
}

export async function getMessageHistory(agentId: string, contactId: string, limit = 20) {
  // Only return user/assistant turns. Reserved roles (offered_slots etc.) are
  // structured context lifted into the prompt by the caller, not chat history.
  return db.conversationMessage.findMany({
    where: { agentId, contactId, role: { in: ['user', 'assistant'] } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

/**
 * Persist the slots returned by get_available_slots so the next turn's
 * prompt builder can surface them — and so a confirmation reply ("yes",
 * "11.45") can be locked to a concrete ISO timestamp instead of the model
 * re-fetching and getting a different set.
 */
export async function recordOfferedSlots(params: {
  agentId: string
  locationId: string
  contactId: string
  conversationId: string
  slots: unknown
  timezone?: string | null
}): Promise<void> {
  const { agentId, locationId, contactId, conversationId, slots, timezone } = params
  await db.conversationMessage.create({
    data: {
      agentId,
      locationId,
      contactId,
      conversationId,
      role: OFFERED_SLOTS_ROLE,
      content: JSON.stringify({ slots, timezone: timezone ?? null, recordedAt: new Date().toISOString() }),
    },
  })
}

/**
 * Mark any prior offered-slots context as consumed (e.g. after book_appointment
 * succeeds). Reads downstream of this row treat earlier offers as stale.
 */
export async function clearOfferedSlots(params: {
  agentId: string
  locationId: string
  contactId: string
  conversationId: string
}): Promise<void> {
  const { agentId, locationId, contactId, conversationId } = params
  await db.conversationMessage.create({
    data: {
      agentId,
      locationId,
      contactId,
      conversationId,
      role: CLEARED_OFFERED_SLOTS_ROLE,
      content: JSON.stringify({ clearedAt: new Date().toISOString() }),
    },
  })
}

/**
 * Returns the most recent offered-slots payload for this contact, IF that
 * payload is more recent than the latest clear marker. Returns null when
 * there's nothing live to surface to the agent.
 */
export async function getLastOfferedSlots(
  agentId: string,
  contactId: string,
): Promise<{ slots: unknown; timezone: string | null; recordedAt: string } | null> {
  const latest = await db.conversationMessage.findFirst({
    where: {
      agentId,
      contactId,
      role: { in: [OFFERED_SLOTS_ROLE, CLEARED_OFFERED_SLOTS_ROLE] },
    },
    orderBy: { createdAt: 'desc' },
  })
  if (!latest || latest.role !== OFFERED_SLOTS_ROLE) return null
  try {
    const parsed = JSON.parse(latest.content)
    return {
      slots: parsed.slots,
      timezone: parsed.timezone ?? null,
      recordedAt: parsed.recordedAt ?? latest.createdAt.toISOString(),
    }
  } catch {
    return null
  }
}

export async function getMemorySummary(agentId: string, contactId: string): Promise<string | null> {
  const memory = await db.contactMemory.findUnique({
    where: { agentId_contactId: { agentId, contactId } },
  })
  return memory?.summary ?? null
}

/**
 * Like getMemorySummary but also returns when the summary was last
 * regenerated, so the prompt can surface "as of 3 days ago" stamps and
 * the agent can judge how stale the prior context is.
 */
export async function getMemorySummaryWithMeta(
  agentId: string,
  contactId: string,
): Promise<{ summary: string; updatedAt: Date } | null> {
  const memory = await db.contactMemory.findUnique({
    where: { agentId_contactId: { agentId, contactId } },
  })
  if (!memory?.summary) return null
  return { summary: memory.summary, updatedAt: memory.updatedAt }
}

export async function updateContactMemorySummary(
  agentId: string,
  locationId: string,
  contactId: string
) {
  try {
    const messages = await getMessageHistory(agentId, contactId, 30)
    if (messages.length < 4) return // not enough history yet

    const transcript = messages
      .map(m => `${m.role === 'user' ? 'Contact' : 'Agent'}: ${m.content}`)
      .join('\n')

    const res = await client.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Summarise this SMS conversation in 2-3 sentences. Focus on: what the contact wants, any key info they shared (budget, timeline, objections), and where things stand. Be factual and brief.\n\n${transcript}`,
      }],
    })

    const summary = (res.content[0] as Anthropic.TextBlock).text

    await db.contactMemory.upsert({
      where: { agentId_contactId: { agentId, contactId } },
      create: { agentId, locationId, contactId, summary },
      update: { summary },
    })
  } catch {
    // Fire-and-forget — don't let memory errors break the main flow
  }
}

/**
 * Widget-channel equivalent of updateContactMemorySummary.
 *
 * The cookie-based visitorId already gives us a stable identity for
 * returning visitors. What we lacked was a long-term memory layer that
 * survives the rolling 20-message window — by day 50 a chatty visitor's
 * day-1 questions would be gone from history with nothing summarising
 * them.
 *
 * This reads across ALL of the visitor's WidgetMessage rows (every
 * conversation they've ever had with this widget), summarises with Haiku,
 * and writes into ContactMemory keyed by ("visitor:<id>") — the same
 * shape runAgent's read path uses, so the summary surfaces in the
 * "What You Already Know About This Contact" prompt block automatically.
 */
export async function updateWidgetMemorySummary(params: {
  agentId: string
  workspaceId: string
  visitorId: string
}): Promise<void> {
  const { agentId, workspaceId, visitorId } = params
  try {
    // Pull the most recent 30 messages across every conversation this
    // visitor has had. Cross-conversation memory means a visitor who
    // started chatting last week and returns today gets continuity even
    // if today's chat is a brand-new conversationId.
    const recent = await db.widgetMessage.findMany({
      where: { conversation: { visitorId } },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { role: true, content: true, createdAt: true },
    })
    if (recent.length < 4) return
    const ordered = recent.reverse()

    const transcript = ordered
      .map(m => {
        const speaker = m.role === 'visitor' ? 'Visitor' : m.role === 'agent' ? 'Agent' : 'System'
        return `${speaker}: ${m.content}`
      })
      .join('\n')

    const res = await client.messages.create({
      model: 'claude-haiku-4-20250514',
      max_tokens: 250,
      messages: [{
        role: 'user',
        content: `Summarise this chat-widget conversation in 2-4 sentences. Focus on: who the visitor is (if they shared a name/email/role), what they're trying to do, any key facts (budget, timeline, objections, what page they're on), and where things stand. Be factual and brief — this becomes long-term memory the agent uses when the same visitor returns later.\n\n${transcript}`,
      }],
    })

    const summary = (res.content[0] as Anthropic.TextBlock).text
    const contactId = `visitor:${visitorId}`
    // The ContactMemory schema requires a locationId. We use the
    // workspace-prefixed widget pseudo-location so the row co-exists
    // cleanly with widget routing, and runAgent's read path doesn't
    // care what locationId says — it queries on (agentId, contactId).
    const locationId = `widget:workspace:${workspaceId}`

    await db.contactMemory.upsert({
      where: { agentId_contactId: { agentId, contactId } },
      create: { agentId, locationId, contactId, summary },
      update: { summary },
    })
  } catch {
    // Fire-and-forget — never let memory writes break the agent flow.
  }
}
