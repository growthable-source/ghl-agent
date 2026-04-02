import { db } from './db'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

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
  return db.conversationMessage.findMany({
    where: { agentId, contactId },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
}

export async function getMemorySummary(agentId: string, contactId: string): Promise<string | null> {
  const memory = await db.contactMemory.findUnique({
    where: { agentId_contactId: { agentId, contactId } },
  })
  return memory?.summary ?? null
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
