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
]

// ─── Tool execution ────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  locationId: string
): Promise<string> {
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
        const result = await bookAppointment(locationId, {
          calendarId: input.calendarId as string,
          contactId: input.contactId as string,
          startTime: input.startTime as string,
          endTime: '',
          title: input.title as string | undefined,
          notes: input.notes as string | undefined,
        })
        return JSON.stringify({ success: true, ...result })
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
  contactId: string
  conversationId?: string
  incomingMessage: string
  messageHistory?: Message[]
  systemPrompt?: string
  enabledTools?: string[]
  persona?: PersonaSettings
}): Promise<AgentResponse> {
  const { locationId, contactId, conversationId, incomingMessage, messageHistory, systemPrompt, enabledTools, persona } = opts

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
        locationId
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
