/**
 * AI Agent
 * Claude-powered response engine. Uses tool_use to take actions in the CRM.
 */

import Anthropic from '@anthropic-ai/sdk'
import {
  getContact,
  sendMessage,
  updateContact,
  addTagsToContact,
  getOpportunitiesForContact,
  updateOpportunityStage,
  searchConversations,
  getFreeSlots,
  bookAppointment,
  searchContacts,
  createContact,
  createAppointmentNote,
} from './crm-client'
import { getValidAccessToken } from './token-store'
import { buildPersonaBlock, applyTypos, calculateTypingDelay, type PersonaSettings } from './persona'
import type { AgentContext, Message } from '@/types'

const client = new Anthropic()

// ─── Tools the agent can use ───────────────────────────────────────────────

const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_contact_details',
    description: 'Fetch full contact details including name, email, phone, tags, and source.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string', description: 'The contact ID' },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'send_sms',
    description: 'Send an SMS reply to the contact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        conversationId: { type: 'string' },
        message: { type: 'string', description: 'The SMS message text' },
      },
      required: ['contactId', 'message'],
    },
  },
  {
    name: 'update_contact_tags',
    description: 'Add tags to a contact to categorise or flag them.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
      },
      required: ['contactId', 'tags'],
    },
  },
  {
    name: 'get_opportunities',
    description: 'Get active pipeline opportunities for a contact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'move_opportunity_stage',
    description: 'Move an opportunity to a different pipeline stage.',
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunityId: { type: 'string' },
        pipelineStageId: { type: 'string', description: 'Target stage ID' },
        reason: { type: 'string', description: 'Why moving to this stage' },
      },
      required: ['opportunityId', 'pipelineStageId'],
    },
  },
  {
    name: 'add_contact_note',
    description: 'Add a note or update the contact record with new information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        note: { type: 'string', description: 'Note content to save' },
      },
      required: ['contactId', 'note'],
    },
  },
  {
    name: 'get_available_slots',
    description: 'Get available appointment slots for a calendar on a given date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        calendarId: { type: 'string', description: 'The GHL calendar ID' },
        startDate: { type: 'string', description: 'Start date in ISO format (YYYY-MM-DD)' },
        endDate: { type: 'string', description: 'End date in ISO format (YYYY-MM-DD)' },
      },
      required: ['calendarId', 'startDate', 'endDate'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Book an appointment for the contact on a calendar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        calendarId: { type: 'string', description: 'The GHL calendar ID' },
        contactId: { type: 'string' },
        startTime: { type: 'string', description: 'Start time in ISO format' },
        title: { type: 'string', description: 'Appointment title' },
        notes: { type: 'string', description: 'Optional notes for the appointment' },
      },
      required: ['calendarId', 'contactId', 'startTime'],
    },
  },
  {
    name: 'search_contacts',
    description: 'Search for contacts by name, email, or phone number.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query — name, email, or phone' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_contact',
    description: 'Create a new contact in the CRM.',
    input_schema: {
      type: 'object' as const,
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
      },
      required: ['firstName'],
    },
  },
  {
    name: 'send_email',
    description: 'Send an email to the contact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string', description: 'Email body text' },
      },
      required: ['contactId', 'subject', 'body'],
    },
  },
  {
    name: 'create_opportunity',
    description: 'Create a new pipeline opportunity for the contact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        name: { type: 'string' },
        pipelineId: { type: 'string' },
        pipelineStageId: { type: 'string' },
        monetaryValue: { type: 'number' },
      },
      required: ['contactId', 'name', 'pipelineId', 'pipelineStageId'],
    },
  },
  {
    name: 'update_opportunity_value',
    description: 'Update the monetary value of an opportunity.',
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunityId: { type: 'string' },
        monetaryValue: { type: 'number' },
      },
      required: ['opportunityId', 'monetaryValue'],
    },
  },
  {
    name: 'get_calendar_events',
    description: 'Get upcoming calendar appointments for a contact.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'create_appointment_note',
    description: 'Add a note to a booked appointment. Always use this after booking to record what the meeting is about and any relevant context from the conversation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointmentId: { type: 'string', description: 'The appointment/event ID returned from book_appointment' },
        body: { type: 'string', description: 'The note content — include what the meeting is about and key context' },
      },
      required: ['appointmentId', 'body'],
    },
  },
  {
    name: 'save_qualifying_answer',
    description: 'Save a qualifying question answer for this contact. Call this whenever the contact answers one of the qualifying questions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        fieldKey: { type: 'string', description: 'The field key of the qualifying question that was answered' },
        answer: { type: 'string', description: 'The contact\'s answer' },
      },
      required: ['contactId', 'fieldKey', 'answer'],
    },
  },
  {
    name: 'score_lead',
    description: 'Score a lead from 1-100 based on buying signals, engagement, and qualification. Save the score to the contact. Use this after qualifying or when you detect strong intent.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        score: { type: 'number', description: 'Lead score 1-100. 80+ = hot, 50-79 = warm, below 50 = cold' },
        reason: { type: 'string', description: 'Brief reason for the score' },
      },
      required: ['contactId', 'score', 'reason'],
    },
  },
  {
    name: 'detect_sentiment',
    description: 'Analyse the sentiment of the conversation. Use this when the contact seems frustrated, angry, or very positive. Tags the contact and can trigger escalation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        sentiment: { type: 'string', description: 'One of: very_positive, positive, neutral, negative, very_negative' },
        summary: { type: 'string', description: 'Brief summary of why this sentiment was detected' },
      },
      required: ['contactId', 'sentiment', 'summary'],
    },
  },
  {
    name: 'schedule_followup',
    description: 'Schedule an automated follow-up SMS to be sent after a delay. Use this to re-engage contacts who go quiet, or to send a check-in after a booking.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        message: { type: 'string', description: 'The follow-up SMS message' },
        delayHours: { type: 'number', description: 'Hours to wait before sending. e.g. 24 = tomorrow, 72 = 3 days' },
      },
      required: ['contactId', 'message', 'delayHours'],
    },
  },
  {
    name: 'transfer_to_human',
    description: 'Escalate the conversation to a human agent. Use this when the AI cannot resolve the issue, the contact explicitly asks for a human, or sentiment is very negative.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        reason: { type: 'string', description: 'Why the transfer is needed' },
        contextSummary: { type: 'string', description: 'Summary of the conversation so far for the human agent' },
      },
      required: ['contactId', 'reason'],
    },
  },
]

// ─── Tool execution ────────────────────────────────────────────────────────

function executeSandboxTool(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'get_contact_details':
      return JSON.stringify({ id: input.contactId, firstName: 'Test', lastName: 'User', phone: '+10000000000', email: 'test@example.com', tags: [] })
    case 'send_sms':
      return JSON.stringify({ success: true, note: '[Sandbox: SMS not actually sent]', message: input.message })
    case 'send_email':
      return JSON.stringify({ success: true, note: '[Sandbox: Email not actually sent]' })
    case 'update_contact_tags':
      return JSON.stringify({ success: true, note: `[Sandbox: Tags "${(input.tags as string[]).join(', ')}" not actually applied]` })
    case 'get_opportunities':
      return JSON.stringify([{ id: 'opp-sandbox', name: 'Test Opportunity', pipelineStageId: 'stage-1', monetaryValue: 1000 }])
    case 'move_opportunity_stage':
      return JSON.stringify({ success: true, note: '[Sandbox: Stage not actually moved]' })
    case 'add_contact_note':
      return JSON.stringify({ success: true, note: '[Sandbox: Note not actually saved]' })
    case 'get_available_slots':
      return JSON.stringify([
        { startTime: '2025-01-15T09:00:00Z', endTime: '2025-01-15T09:30:00Z' },
        { startTime: '2025-01-15T10:00:00Z', endTime: '2025-01-15T10:30:00Z' },
        { startTime: '2025-01-15T14:00:00Z', endTime: '2025-01-15T14:30:00Z' },
      ])
    case 'book_appointment':
      return JSON.stringify({ success: true, note: '[Sandbox: Appointment not actually booked]', startTime: input.startTime })
    case 'search_contacts':
      return JSON.stringify([{ id: 'contact-sandbox', firstName: 'Test', lastName: 'User', phone: '+10000000000' }])
    case 'create_contact':
      return JSON.stringify({ success: true, note: '[Sandbox: Contact not actually created]', contact: { id: 'new-sandbox', ...input } })
    case 'create_opportunity':
      return JSON.stringify({ success: true, note: '[Sandbox: Opportunity not actually created]' })
    case 'update_opportunity_value':
      return JSON.stringify({ success: true, note: '[Sandbox: Value not actually updated]' })
    case 'get_calendar_events':
      return JSON.stringify({ events: [], note: '[Sandbox: No real events]' })
    case 'save_qualifying_answer':
      return JSON.stringify({ success: true, note: `[Sandbox: Answer "${input.answer}" for field "${input.fieldKey}" not actually saved]` })
    case 'score_lead':
      return JSON.stringify({ success: true, note: `[Sandbox: Lead scored ${input.score}/100 — "${input.reason}"]` })
    case 'detect_sentiment':
      return JSON.stringify({ success: true, note: `[Sandbox: Sentiment "${input.sentiment}" — "${input.summary}"]` })
    case 'schedule_followup':
      return JSON.stringify({ success: true, note: `[Sandbox: Follow-up "${input.message}" scheduled in ${input.delayHours}h — not actually queued]` })
    case 'transfer_to_human':
      return JSON.stringify({ success: true, note: `[Sandbox: Transfer to human requested — "${input.reason}"]` })
    default:
      return JSON.stringify({ note: `[Sandbox: ${toolName} not executed]` })
  }
}

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  locationId: string,
  sandbox = false,
  agentId?: string
): Promise<string> {
  if (sandbox) return executeSandboxTool(toolName, input)
  try {
    switch (toolName) {
      case 'get_contact_details': {
        const contact = await getContact(locationId, input.contactId as string)
        return JSON.stringify(contact)
      }
      case 'send_sms': {
        const result = await sendMessage(locationId, {
          type: 'SMS',
          contactId: input.contactId as string,
          conversationId: input.conversationId as string | undefined,
          message: input.message as string,
        })
        return JSON.stringify({ success: true, ...result })
      }
      case 'update_contact_tags': {
        await addTagsToContact(locationId, input.contactId as string, input.tags as string[])
        return JSON.stringify({ success: true })
      }
      case 'get_opportunities': {
        const opps = await getOpportunitiesForContact(locationId, input.contactId as string)
        return JSON.stringify(opps)
      }
      case 'move_opportunity_stage': {
        const opp = await updateOpportunityStage(
          locationId,
          input.opportunityId as string,
          input.pipelineStageId as string
        )
        return JSON.stringify({ success: true, opportunity: opp })
      }
      case 'add_contact_note': {
        // Uses update contact with a custom note field — adapt to your custom fields
        await updateContact(locationId, input.contactId as string, {
          // You can store notes in custom fields or use the notes endpoint
        } as any)
        return JSON.stringify({ success: true, note: input.note })
      }
      case 'get_available_slots': {
        const slots = await getFreeSlots(
          locationId,
          input.calendarId as string,
          input.startDate as string,
          input.endDate as string
        )
        return JSON.stringify(slots)
      }
      case 'book_appointment': {
        const startTime = input.startTime as string
        let endTime = (input.endTime as string) || ''
        if (!endTime && startTime) {
          const end = new Date(startTime)
          end.setMinutes(end.getMinutes() + 30)
          endTime = end.toISOString()
        }
        const result = await bookAppointment(locationId, {
          calendarId: input.calendarId as string,
          contactId: input.contactId as string,
          startTime,
          endTime,
          title: input.title as string | undefined,
          notes: input.notes as string | undefined,
        })
        return JSON.stringify({ success: true, ...result })
      }
      case 'create_appointment_note': {
        const noteResult = await createAppointmentNote(
          locationId,
          input.appointmentId as string,
          input.body as string
        )
        return JSON.stringify({ success: true, ...noteResult })
      }
      case 'search_contacts': {
        const contacts = await searchContacts(locationId, input.query as string)
        return JSON.stringify(contacts)
      }
      case 'create_contact': {
        const contact = await createContact(locationId, {
          firstName: input.firstName as string,
          lastName: input.lastName as string | undefined,
          phone: input.phone as string | undefined,
          email: input.email as string | undefined,
        })
        return JSON.stringify({ success: true, contact })
      }
      case 'send_email': {
        const result = await sendMessage(locationId, {
          type: 'Email',
          contactId: input.contactId as string,
          message: input.body as string,
          subject: input.subject as string,
        })
        return JSON.stringify({ success: true, ...result })
      }
      case 'create_opportunity': {
        const token = await getValidAccessToken(locationId)
        if (!token) return JSON.stringify({ error: 'Not authenticated' })
        const res = await fetch('https://services.leadconnectorhq.com/opportunities/', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            title: input.name,
            contactId: input.contactId,
            pipelineId: input.pipelineId,
            pipelineStageId: input.pipelineStageId,
            monetaryValue: input.monetaryValue,
            locationId,
          }),
        })
        const opp = await res.json()
        return JSON.stringify({ success: true, ...opp })
      }
      case 'update_opportunity_value': {
        const token = await getValidAccessToken(locationId)
        if (!token) return JSON.stringify({ error: 'Not authenticated' })
        const res = await fetch(`https://services.leadconnectorhq.com/opportunities/${input.opportunityId as string}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            Version: '2021-07-28',
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ monetaryValue: input.monetaryValue }),
        })
        const opp = await res.json()
        return JSON.stringify({ success: true, ...opp })
      }
      case 'get_calendar_events': {
        const token = await getValidAccessToken(locationId)
        if (!token) return JSON.stringify({ error: 'Not authenticated' })
        const res = await fetch(`https://services.leadconnectorhq.com/calendars/events?contactId=${input.contactId as string}&locationId=${locationId}`, {
          headers: { Authorization: `Bearer ${token}`, Version: '2021-04-15', Accept: 'application/json' },
        })
        const data = await res.json()
        return JSON.stringify(data)
      }
      case 'save_qualifying_answer': {
        if (agentId) {
          const { saveQualifyingAnswer } = await import('./qualifying')
          await saveQualifyingAnswer(
            agentId,
            input.contactId as string,
            input.fieldKey as string,
            input.answer as string,
            locationId
          )
        }
        return JSON.stringify({ success: true })
      }
      case 'score_lead': {
        const score = input.score as number
        const reason = input.reason as string
        const scoreTag = score >= 80 ? 'lead-hot' : score >= 50 ? 'lead-warm' : 'lead-cold'
        await addTagsToContact(locationId, input.contactId as string, [scoreTag])
        if (agentId) {
          const { db: prisma } = await import('./db')
          await prisma.leadScore.upsert({
            where: { agentId_contactId: { agentId, contactId: input.contactId as string } },
            create: { agentId, locationId, contactId: input.contactId as string, score, reason },
            update: { score, reason },
          })
        }
        return JSON.stringify({ success: true, score, tier: scoreTag, reason })
      }
      case 'detect_sentiment': {
        const sentiment = input.sentiment as string
        const summary = input.summary as string
        // Tag with sentiment
        await addTagsToContact(locationId, input.contactId as string, [`sentiment-${sentiment}`])
        // If very negative, also tag for escalation
        if (sentiment === 'very_negative' || sentiment === 'negative') {
          await addTagsToContact(locationId, input.contactId as string, ['needs-attention'])
        }
        return JSON.stringify({ success: true, sentiment, summary })
      }
      case 'schedule_followup': {
        const { db: prisma } = await import('./db')
        const delayMs = (input.delayHours as number) * 60 * 60 * 1000
        const scheduledAt = new Date(Date.now() + delayMs)
        await prisma.scheduledMessage.create({
          data: {
            locationId,
            agentId: agentId || null,
            contactId: input.contactId as string,
            channel: 'SMS',
            message: input.message as string,
            scheduledAt,
            status: 'pending',
          },
        })
        return JSON.stringify({ success: true, scheduledAt: scheduledAt.toISOString(), message: input.message })
      }
      case 'transfer_to_human': {
        // Tag contact for human follow-up and pause the AI
        await addTagsToContact(locationId, input.contactId as string, ['human-requested', 'ai-paused'])
        // Pause the conversation state
        if (agentId) {
          const { db: prisma } = await import('./db')
          await prisma.conversationStateRecord.updateMany({
            where: { agentId, contactId: input.contactId as string, state: 'ACTIVE' },
            data: { state: 'PAUSED', pauseReason: `Transfer to human: ${input.reason}`, pausedAt: new Date() },
          })
        }
        return JSON.stringify({
          success: true,
          reason: input.reason,
          contextSummary: input.contextSummary || '',
          note: 'Conversation paused. Contact tagged for human follow-up.',
        })
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  } catch (err: any) {
    return JSON.stringify({ error: err.message })
  }
}

// ─── Build system prompt ───────────────────────────────────────────────────

function buildSystemPrompt(ctx: AgentContext, customPrompt?: string, persona?: PersonaSettings): string {
  const contactName = ctx.contact?.name || ctx.contact?.firstName || 'this contact'
  const base = customPrompt || `You are a helpful, professional sales assistant managing SMS conversations.`

  let prompt = `${base}

## Current Conversation Context
- Contact: ${contactName}
- Phone: ${ctx.contact?.phone ?? 'unknown'}
- Tags: ${ctx.contact?.tags?.join(', ') || 'none'}
- Source: ${ctx.contact?.source ?? 'unknown'}
- Location ID: ${ctx.locationId}

## Your Behaviour
- Keep SMS replies concise (1–3 sentences max)
- Be conversational and human — never reveal you are an AI
- Always aim to move the lead forward (book a call, answer objections, qualify)
- If you need more contact info, use get_contact_details first
- After replying via send_sms, tag contacts appropriately
- If a lead is clearly interested, move their opportunity stage forward

## Booking Appointments
- BEFORE booking, always collect: the contact's name, email address, and what the meeting is about
- If you don't have their email, ask for it — you need it for the calendar invite
- After booking, ALWAYS create an appointment note summarising what the meeting is about and any context from the conversation
- Confirm the date, time, and purpose back to the contact after booking

## Tone
Professional but warm. Match the contact's energy.`

  if (persona) {
    prompt += buildPersonaBlock(persona)
  }

  return prompt
}

// ─── Main agent function ───────────────────────────────────────────────────

export interface ToolCallEntry {
  tool: string
  input: Record<string, unknown>
  output: string
  durationMs: number
}

export interface AgentResponse {
  reply: string | null        // The SMS text sent (null if no SMS was sent)
  actionsPerformed: string[]  // List of tools that were called
  tokensUsed: number
  toolCallTrace: ToolCallEntry[]
}

export async function runAgent(opts: {
  locationId: string
  agentId?: string
  contactId: string
  conversationId?: string
  incomingMessage: string
  messageHistory?: Message[]
  systemPrompt?: string
  enabledTools?: string[]
  persona?: PersonaSettings
  sandbox?: boolean
}): Promise<AgentResponse> {
  const { locationId, agentId, contactId, conversationId, incomingMessage, messageHistory, systemPrompt, enabledTools, persona, sandbox } = opts
  const isSandbox = sandbox || contactId.startsWith('playground-')

  // Build message history for Claude
  const messages: Anthropic.MessageParam[] = []

  // Include recent message history as context
  if (messageHistory && messageHistory.length > 0) {
    const recent = messageHistory.slice(-8) // last 8 messages
    for (const msg of recent) {
      // Skip if it's the same as the incoming message
      if (msg.body === incomingMessage && msg.direction === 'inbound') continue
      messages.push({
        role: msg.direction === 'inbound' ? 'user' : 'assistant',
        content: msg.body,
      })
    }
  }

  // Add the current incoming message
  messages.push({
    role: 'user',
    content: `[Inbound SMS from contact ${contactId}]: ${incomingMessage}`,
  })

  const actionsPerformed: string[] = []
  const toolCallTrace: ToolCallEntry[] = []
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let smsSent: string | null = null

  // Filter tools based on agent configuration
  const tools = enabledTools ? AGENT_TOOLS.filter(t => enabledTools.includes(t.name)) : AGENT_TOOLS

  // Agentic loop — keeps going until Claude stops calling tools
  let currentMessages = [...messages]
  const MAX_ITERATIONS = 5

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: buildSystemPrompt({ locationId, contactId } as AgentContext, systemPrompt, persona),
      tools,
      messages: currentMessages,
    })

    totalInputTokens += response.usage.input_tokens
    totalOutputTokens += response.usage.output_tokens

    // Process response content
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
    const textBlocks = response.content.filter(b => b.type === 'text')

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      // Done — extract any final text
      const finalText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n')
      if (finalText && !smsSent) {
        // If Claude wrote a reply but didn't use send_sms, send it now
        let msgToSend = finalText
        if (persona?.simulateTypos) msgToSend = applyTypos(msgToSend)
        if (persona?.typingDelayEnabled) {
          const delay = calculateTypingDelay(msgToSend, persona.typingDelayMinMs, persona.typingDelayMaxMs)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        await sendMessage(locationId, {
          type: 'SMS',
          contactId,
          conversationId,
          message: msgToSend,
        })
        smsSent = msgToSend
        actionsPerformed.push('send_sms (auto)')
      }
      break
    }

    // Execute all tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of toolUseBlocks) {
      const toolBlock = block as Anthropic.ToolUseBlock
      actionsPerformed.push(toolBlock.name)
      const toolStart = Date.now()
      const result = await executeTool(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        locationId,
        isSandbox,
        agentId
      )
      toolCallTrace.push({
        tool: toolBlock.name,
        input: toolBlock.input as Record<string, unknown>,
        output: result,
        durationMs: Date.now() - toolStart,
      })

      // Track SMS sends
      if (toolBlock.name === 'send_sms') {
        const parsed = JSON.parse(result)
        if (parsed.success) {
          let msg = (toolBlock.input as { message: string }).message
          if (persona?.simulateTypos) msg = applyTypos(msg)
          smsSent = msg
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result,
      })
    }

    // Continue the loop with the tool results
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ]
  }

  return {
    reply: smsSent,
    actionsPerformed,
    tokensUsed: totalInputTokens + totalOutputTokens,
    toolCallTrace,
  }
}
