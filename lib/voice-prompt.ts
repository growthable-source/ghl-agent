import { buildKnowledgeBlock } from '@/lib/rag'
import { searchContacts } from '@/lib/crm-client'
import { getUnansweredQuestions, buildQualifyingPromptBlock } from '@/lib/qualifying'
import { buildPersonaBlock } from '@/lib/persona'

export const VAPI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Book an appointment for the caller',
      parameters: {
        type: 'object',
        properties: {
          startTime: { type: 'string', description: 'ISO datetime for the appointment' },
          name: { type: 'string', description: 'Caller name for the booking' },
        },
        required: ['startTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description: 'Get available appointment slots for booking',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to check in YYYY-MM-DD format' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'tag_contact',
      description: 'Tag the caller contact with a label',
      parameters: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Tag to apply to the contact' },
        },
        required: ['tag'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_sms_followup',
      description: 'Send an SMS follow-up message to the caller after the call',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The SMS message to send after the call' },
        },
        required: ['message'],
      },
    },
  },
]

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
  try {
    const contacts = await searchContacts(locationId, callerPhone)
    if (contacts && contacts.length > 0) {
      const c = contacts[0] as any
      contactId = c.id
      const name = [c.firstName, c.lastName].filter(Boolean).join(' ')
      contactContext = `\n\n## ${direction === 'outbound' ? 'Contact' : 'Caller'} Info\nName: ${name || 'Unknown'}\nPhone: ${callerPhone}\nContact ID: ${c.id}`
      if (c.tags?.length) contactContext += `\nTags: ${c.tags.join(', ')}`
    }
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
    calendarBlock = `\n\n## Calendar Configuration\nCalendar ID: ${agent.calendarId}\nAlways use get_available_slots before booking. Use this calendar ID.`
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
You are on a live phone call. Follow these rules strictly:
- Speak naturally and conversationally — no bullet points, no markdown, no lists
- Keep responses SHORT — 1-3 sentences max unless the caller asks for detail
- Don't read out URLs, email addresses, or long codes
- If you need to check something, say "Let me look that up for you" or "One moment"
- When the caller wants to book, use get_available_slots first, then book_appointment
- After booking, offer to send an SMS confirmation using send_sms_followup
- If you can't help, offer to have someone call them back
${contactContext}${outboundBlock}
${agent.instructions ? `\n## Additional Instructions\n${agent.instructions}` : ''}
${knowledgeBlock}${calendarBlock}${qualifyingBlock}${personaBlock}${fallbackBlock}${buildToolConditions(voiceTools)}`
}
