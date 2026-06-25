import { buildKnowledgeBlock } from '@/lib/rag'
import { searchContacts } from '@/lib/crm-client'
import { getUnansweredQuestions, buildQualifyingPromptBlock } from '@/lib/qualifying'
import { buildPersonaBlock } from '@/lib/persona'
import { db } from '@/lib/db'
import { buildVoiceCommerceBlock } from '@/lib/commerce/shopify/voice-prompt'

/**
 * The one voice-specific tool that isn't in the canonical AGENT_TOOLS
 * catalogue: per-turn knowledge retrieval. The webhook runs vector
 * retrieval and returns the top matched chunks. Every OTHER voice tool
 * (booking, contact capture, etc.) is generated from AGENT_TOOLS via
 * buildVoiceFunctionTools — voice no longer has a parallel hardcoded set.
 */
export const VOICE_KNOWLEDGE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'query_knowledge',
    description: 'Search the workspace knowledge base for information relevant to the caller\'s question. ALWAYS call this BEFORE answering any question that asks for specific facts — product details, release notes, FAQ answers, policies, pricing, anything the merchant has documented. Pass the caller\'s question restated naturally. Returns up to 5 ranked snippets; if it returns nothing, say so honestly instead of guessing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The caller\'s question, restated naturally as a search query.' },
      },
      required: ['query'],
    },
  },
}

export function buildToolConditions(voiceTools?: any[] | null): string {
  if (!voiceTools || !Array.isArray(voiceTools)) return ''
  const conditioned = voiceTools.filter((t: any) => t.condition)
  if (conditioned.length === 0) return ''
  const lines = conditioned.map((t: any) => `- ${t.function?.name}: ${t.condition}`)
  return `\n\n## Tool Usage Rules\n${lines.join('\n')}`
}

export async function buildVoiceSystemPrompt(
  agent: any,
  knowledgeEntries: any[],
  callerPhone: string,
  locationId: string,
  voiceTools?: any[] | null,
  direction: 'inbound' | 'outbound' = 'inbound'
): Promise<string> {
  let contactContext = ''
  let contactId = ''
  let callerEmail: string | null = null
  try {
    const contacts = await searchContacts(locationId, callerPhone)
    if (contacts && contacts.length > 0) {
      const c = contacts[0] as any
      contactId = c.id
      callerEmail = c.email ?? null
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
      contactContext = `\n\n## ${direction === 'outbound' ? 'Contact' : 'Caller'} Info\nName: ${name || 'Unknown'}\nPhone: ${callerPhone}\nContact ID: ${c.id}`
      if (c.tags?.length) contactContext += `\nTags: ${c.tags.join(', ')}`
    }
  } catch {}

  // Resolve workspaceId from the location so we can check for a
  // connected Shopify store. Failures here are silent — the agent
  // just doesn't get commerce context, which is the same state as
  // "no Shopify connected."
  let workspaceId: string | null = null
  try {
    const loc = await db.location.findUnique({ where: { id: locationId }, select: { workspaceId: true } })
    workspaceId = loc?.workspaceId ?? null
  } catch {}
  let commerceBlock = ''
  try {
    commerceBlock = await buildVoiceCommerceBlock({
      workspaceId,
      callerEmail,
      callerPhone,
    })
  } catch {}

  const knowledgeBlock = buildKnowledgeBlock(knowledgeEntries)

  // Qualifying questions
  let qualifyingBlock = ''
  if (agent.id && contactId) {
    try {
      const unanswered = await getUnansweredQuestions(agent.id, contactId)
      qualifyingBlock = buildQualifyingPromptBlock(unanswered, agent.qualifyingStyle ?? 'strict')
    } catch {}
  }

  // Persona
  let personaBlock = ''
  try { personaBlock = buildPersonaBlock(agent) } catch {}

  // Fallback
  const fb = agent.fallbackBehavior ?? 'message'
  const fm = agent.fallbackMessage
  let fallbackBlock = '\n\n## When You Don\'t Know the Answer\nDo NOT guess or make things up.'
  if (fb === 'transfer') {
    fallbackBlock += ' Tell the caller you\'ll connect them with someone who can help.'
  } else if (fm) {
    fallbackBlock += ` Say: "${fm}"`
  } else {
    fallbackBlock += ' Say you\'ll find out and get back to them.'
  }

  // Calendar
  let calendarBlock = ''
  if (agent.calendarId) {
    calendarBlock = `\n\n## Calendar Configuration\nThis agent can book appointments. Always call get_available_slots before offering times, then book_appointment to commit. You do not pass a calendar id — it is wired automatically.`
  } else {
    calendarBlock = `\n\n## Booking\nNo calendar is connected yet, so you cannot book on this call. If the caller wants to schedule, take their name and email (save them with upsert_contact) and tell them someone will follow up to confirm a time.`
  }

  // Outbound context
  let outboundBlock = ''
  if (direction === 'outbound') {
    outboundBlock = `\n\n## OUTBOUND CALL CONTEXT
You are making an outbound call TO the contact. They did NOT call you.
- Introduce yourself and state why you are calling
- Be concise and respect their time
- If they seem busy, offer to call back at a better time`
  }

  return `${agent.systemPrompt}

## VOICE CALL INSTRUCTIONS
You are on a live phone call. Follow these rules:
- Speak naturally and conversationally — no bullet points, no markdown, no lists.
- Keep responses SHORT — 1-3 sentences unless the caller asks for detail.
- Don't read out URLs or long codes. Read times back clearly with the timezone.
- Before checking something, say a quick "let me check that" so silence doesn't feel dead.
- If you genuinely can't help, offer to have someone call them back.

### Booking and capturing the caller
When the caller wants to book, or you're taking their details:
- Get their first name and a good email so we can send a confirmation. Ask naturally — you don't need everything before you start helping.
- Save the caller to the CRM as soon as you have a name (and email/phone): call upsert_contact (preferred) or create_contact. The caller's phone is already known — include it. Use the contact id that comes back when you book.
- Check real availability with get_available_slots before offering times. Offer two or three specific options with the timezone.
- When the caller picks a time, book it immediately with book_appointment in the same turn — never say "you're booked" without actually calling the tool.
- If you already recognise the caller (their info is below), don't re-ask — just confirm the email is still right before booking.
${contactContext}${outboundBlock}
${agent.instructions ? `\n## Additional Instructions\n${agent.instructions}` : ''}
${knowledgeBlock}${calendarBlock}${qualifyingBlock}${personaBlock}${fallbackBlock}${commerceBlock}${buildToolConditions(voiceTools)}`
}
