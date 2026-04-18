/**
 * AI Agent
 * Claude-powered response engine. Uses tool_use to take actions in the CRM.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getCrmAdapter } from './crm/factory'
import type { CrmAdapter } from './crm/types'
import { buildPersonaBlock, applyTypos, calculateTypingDelay, type PersonaSettings } from './persona'
import { detectFalseActionClaim, safeFallbackReply } from './action-claim-detector'
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
    name: 'send_reply',
    description: 'Send a reply message to the contact on the current conversation channel (SMS, WhatsApp, Instagram, Facebook, Live Chat, etc.). Always use this tool to respond.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        conversationId: { type: 'string' },
        message: { type: 'string', description: 'The message text to send' },
      },
      required: ['contactId', 'message'],
    },
  },
  // Backward compat — old agents with send_sms in enabledTools still work
  {
    name: 'send_sms',
    description: 'Send an SMS reply to the contact. Prefer send_reply instead, which works on any channel.',
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
    description: 'Step 1 of booking: Fetch available appointment slots. ALWAYS follow this call with a book_appointment call once the contact has picked (or you have proposed) a specific time. Never just list slots and ask the contact to "let you know" — propose a specific slot in your reply.',
    input_schema: {
      type: 'object' as const,
      properties: {
        calendarId: { type: 'string', description: 'The GHL calendar ID — this is provided in your Calendar Configuration section' },
        startDate: { type: 'string', description: 'Start of search window in ISO format (YYYY-MM-DD or full ISO datetime). Default to today.' },
        endDate: { type: 'string', description: 'End of search window in ISO format (YYYY-MM-DD or full ISO datetime). Default to 7 days after startDate.' },
      },
      required: ['calendarId', 'startDate', 'endDate'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Step 2 of booking: ACTUALLY book the appointment. Call this tool to commit the booking — do not just tell the contact "I\'ve scheduled that" without calling this tool, because nothing will be booked. Use the exact startTime string returned by get_available_slots. Preferred flow: (1) get_available_slots → (2) propose a specific slot in your reply → (3) on contact confirmation, call book_appointment IMMEDIATELY in the same turn.',
    input_schema: {
      type: 'object' as const,
      properties: {
        calendarId: { type: 'string', description: 'The GHL calendar ID — provided in your Calendar Configuration section' },
        contactId: { type: 'string', description: 'The contact ID for whom the appointment is booked — this is the current conversation\'s contact' },
        startTime: { type: 'string', description: 'Start time — use the exact startTime string returned by get_available_slots (do not reformat it)' },
        endTime: { type: 'string', description: 'Optional. Defaults to startTime + 30 minutes if omitted.' },
        title: { type: 'string', description: 'Short appointment title like "Demo with Acme" or "Sales Call"' },
        notes: { type: 'string', description: 'Brief context from the conversation — what the contact wants to discuss' },
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
    case 'send_reply':
      return JSON.stringify({ success: true, note: '[Sandbox: Message not actually sent]', message: input.message })
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
    case 'get_available_slots': {
      // Generate realistic-looking future slots starting 2 days from now
      // (avoids the old hardcoded 2025 dates that misled the agent)
      const base = new Date()
      base.setDate(base.getDate() + 2)
      base.setUTCHours(14, 0, 0, 0)
      const slot = (dayOffset: number, hours: number) => {
        const d = new Date(base)
        d.setUTCDate(d.getUTCDate() + dayOffset)
        d.setUTCHours(hours, 0, 0, 0)
        const end = new Date(d)
        end.setUTCMinutes(end.getUTCMinutes() + 30)
        return { startTime: d.toISOString(), endTime: end.toISOString() }
      }
      return JSON.stringify([slot(0, 14), slot(0, 15), slot(1, 10), slot(1, 14)])
    }
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

// Read-only tools are safe to run against the real CRM even in the
// playground — they don't change state, and mocking them makes the
// playground useless for testing calendar availability, opportunity
// lookups, contact details, etc. The agent sees REAL data and reasons
// correctly about it.
const SAFE_READ_ONLY_TOOLS = new Set([
  'get_contact_details',
  'get_opportunities',
  'get_available_slots',
  'get_calendar_events',
  'search_contacts',
])

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  locationId: string,
  sandbox = false,
  agentId?: string,
  channel?: string,
  conversationProviderId?: string,
  adapter?: CrmAdapter
): Promise<string> {
  // In sandbox, allow read-only tools to hit the real CRM so the agent
  // sees actual data. Writes (send_reply, book_appointment, update_*,
  // create_*, etc.) stay sandboxed.
  if (sandbox && !SAFE_READ_ONLY_TOOLS.has(toolName)) {
    return executeSandboxTool(toolName, input)
  }
  // Resolve adapter if not provided (backward compat)
  const crm = adapter ?? (await getCrmAdapter(locationId))
  try {
    switch (toolName) {
      case 'get_contact_details': {
        const contact = await crm.getContact(input.contactId as string)
        return JSON.stringify(contact)
      }
      case 'send_reply': {
        const replyChannel = (channel || 'SMS') as import('@/types').MessageChannelType
        const result = await crm.sendMessage({
          type: replyChannel,
          contactId: input.contactId as string,
          conversationProviderId: conversationProviderId || input.conversationProviderId as string | undefined,
          message: input.message as string,
        })
        return JSON.stringify({ success: true, channel: replyChannel, ...result })
      }
      case 'send_sms': {
        const result = await crm.sendMessage({
          type: 'SMS',
          contactId: input.contactId as string,
          conversationProviderId,
          message: input.message as string,
        })
        return JSON.stringify({ success: true, ...result })
      }
      case 'update_contact_tags': {
        await crm.addTags(input.contactId as string, input.tags as string[])
        return JSON.stringify({ success: true })
      }
      case 'get_opportunities': {
        const opps = await crm.getOpportunitiesForContact(input.contactId as string)
        return JSON.stringify(opps)
      }
      case 'move_opportunity_stage': {
        const opp = await crm.updateOpportunityStage(
          input.opportunityId as string,
          input.pipelineStageId as string
        )
        return JSON.stringify({ success: true, opportunity: opp })
      }
      case 'add_contact_note': {
        await crm.updateContact(input.contactId as string, {} as any)
        return JSON.stringify({ success: true, note: input.note })
      }
      case 'get_available_slots': {
        const slots = await crm.getFreeSlots(
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
          if (isNaN(end.getTime())) {
            return JSON.stringify({
              success: false,
              error: `Invalid startTime format: "${startTime}". Use the exact ISO string returned by get_available_slots.`,
              action: 'Call get_available_slots first, then use the exact startTime from the response.',
            })
          }
          end.setMinutes(end.getMinutes() + 30)
          endTime = end.toISOString()
        }
        try {
          const result = await crm.bookAppointment({
            calendarId: input.calendarId as string,
            contactId: input.contactId as string,
            startTime,
            endTime,
            title: input.title as string | undefined,
            notes: input.notes as string | undefined,
          })
          // Surface the booked time + appointment ID clearly so Claude can confirm
          // the exact slot to the contact and optionally call create_appointment_note
          return JSON.stringify({
            success: true,
            appointmentId: result?.id || result?.appointmentId || null,
            bookedStartTime: startTime,
            bookedEndTime: endTime,
            message: 'Appointment successfully booked. Confirm the exact time to the contact in your next message, and optionally call create_appointment_note to log context.',
            ...(result || {}),
          })
        } catch (err: any) {
          // Detect common failures and give Claude actionable guidance
          const msg = err?.message || 'Unknown error'
          const hint = /slot/i.test(msg) ? 'That slot may no longer be available — call get_available_slots again and propose a different time.'
            : /assignedUserId|team member/i.test(msg) ? 'This calendar requires a team member. The system should auto-assign one — if this persists, a team member needs to be added to the calendar in GHL (Calendar settings → Team & availability).'
            : /calendarId/i.test(msg) ? 'The calendarId appears invalid — use the ID from your Calendar Configuration section exactly.'
            : /contactId/i.test(msg) ? 'The contactId is invalid — use the current conversation contactId (passed in your context).'
            : /timezone|format/i.test(msg) ? 'The startTime format is wrong — use the exact string returned by get_available_slots.'
            : 'Booking failed. Apologize to the contact, try once more with a different slot, or offer to have someone follow up.'
          return JSON.stringify({
            success: false,
            error: msg,
            hint,
          })
        }
      }
      case 'create_appointment_note': {
        const noteResult = await crm.createAppointmentNote(
          input.appointmentId as string,
          input.body as string
        )
        return JSON.stringify({ success: true, ...noteResult })
      }
      case 'search_contacts': {
        const contacts = await crm.searchContacts(input.query as string)
        return JSON.stringify(contacts)
      }
      case 'create_contact': {
        const contact = await crm.createContact({
          firstName: input.firstName as string,
          lastName: input.lastName as string | undefined,
          phone: input.phone as string | undefined,
          email: input.email as string | undefined,
        })
        return JSON.stringify({ success: true, contact })
      }
      case 'send_email': {
        const result = await crm.sendMessage({
          type: 'Email',
          contactId: input.contactId as string,
          message: input.body as string,
          subject: input.subject as string,
        })
        return JSON.stringify({ success: true, ...result })
      }
      case 'create_opportunity': {
        const opp = await crm.createOpportunity({
          name: input.name as string,
          contactId: input.contactId as string,
          pipelineId: input.pipelineId as string,
          pipelineStageId: input.pipelineStageId as string,
          monetaryValue: input.monetaryValue as number | undefined,
        })
        return JSON.stringify({ success: true, ...opp })
      }
      case 'update_opportunity_value': {
        const opp = await crm.updateOpportunityValue(
          input.opportunityId as string,
          input.monetaryValue as number
        )
        return JSON.stringify({ success: true, ...opp })
      }
      case 'get_calendar_events': {
        const data = await crm.getCalendarEvents(input.contactId as string)
        return JSON.stringify(data)
      }
      case 'save_qualifying_answer': {
        if (agentId) {
          const { saveQualifyingAnswer, executeQualifyingAction } = await import('./qualifying')
          await saveQualifyingAnswer(
            agentId,
            input.contactId as string,
            input.fieldKey as string,
            input.answer as string,
            locationId
          )
          const actionResult = await executeQualifyingAction(
            agentId,
            input.fieldKey as string,
            input.answer as string,
            input.contactId as string,
            locationId
          )
          return JSON.stringify({ success: true, action: actionResult })
        }
        return JSON.stringify({ success: true })
      }
      case 'score_lead': {
        const score = input.score as number
        const reason = input.reason as string
        const scoreTag = score >= 80 ? 'lead-hot' : score >= 50 ? 'lead-warm' : 'lead-cold'
        await crm.addTags(input.contactId as string, [scoreTag])
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
        await crm.addTags(input.contactId as string, [`sentiment-${sentiment}`])
        if (sentiment === 'very_negative' || sentiment === 'negative') {
          await crm.addTags(input.contactId as string, ['needs-attention'])
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
        await crm.addTags(input.contactId as string, ['human-requested', 'ai-paused'])
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
    console.error(`[Agent] Tool ${toolName} failed:`, err.message)
    return JSON.stringify({ error: err.message })
  }
}

// ─── Build system prompt ───────────────────────────────────────────────────

export interface FallbackConfig {
  behavior: 'message' | 'transfer' | 'message_and_transfer'
  message?: string | null
}

function buildSystemPrompt(ctx: AgentContext, customPrompt?: string, persona?: PersonaSettings, qualifyingBlock?: string, fallback?: FallbackConfig, channel?: string): string {
  const contactName = ctx.contact?.name || ctx.contact?.firstName || 'this contact'
  const ch = channel || 'SMS'
  const base = customPrompt || `You are a helpful, professional sales assistant managing conversations.`

  const now = new Date()
  const todayISO = now.toISOString().slice(0, 10)
  const in4WeeksISO = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const nowHuman = now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })

  let prompt = `${base}

## Current Conversation Context
- Contact: ${contactName}
- Phone: ${ctx.contact?.phone ?? 'unknown'}
- Tags: ${ctx.contact?.tags?.join(', ') || 'none'}
- Source: ${ctx.contact?.source ?? 'unknown'}
- Location ID: ${ctx.locationId}
- Channel: ${ch}
- Current date/time: ${nowHuman} (today is ${todayISO})

When calling get_available_slots, pass startDate="${todayISO}" and endDate="${in4WeeksISO}" (or narrower if the contact specified a window). NEVER pass dates from last year or next year — the current date is ${todayISO}.

## Your Behaviour
- Keep replies concise (1–3 sentences max) — this is a ${ch} conversation
- Be conversational and human — never reveal you are an AI
- Always aim to move the lead forward (book a call, answer objections, qualify)
- If you need more contact info, use get_contact_details first
- After replying via send_reply, tag contacts appropriately
- If a lead is clearly interested, move their opportunity stage forward
- Use send_reply to respond — it automatically sends on the correct channel (${ch})

## Act Now, Or Commit To When
When a contact asks for something, your reply must match ONE of these patterns:

1. **Do it now** — if a tool can answer the question (e.g. get_available_slots returns instantly), CALL THE TOOL in this same turn and include the result in your reply. Never say "let me check" or "one moment while I look" when the tool is instant.

2. **Commit to a concrete follow-up** — if you truly can't answer in this turn and you have the schedule_followup tool, call it AND tell the contact the exact return time ("I'll check in tomorrow at 10am").

3. **Hand off honestly** — if neither applies, say so plainly: "I'll have someone from our team reach out to you directly" or "our sales team will follow up within the hour". Don't leave vague promises.

**NEVER send a reply like "I'll get back to you with options shortly" without having either (a) called the tool that answers the question, or (b) called schedule_followup to commit to a concrete return time.** That's the same as not coming back — the contact has no idea when or if you will.

If you claim an action was completed ("I've booked you for Tuesday"), you MUST have just called the corresponding tool in this turn. Claiming completion without the tool call is a lie the contact will discover later.

## Booking Appointments
- BEFORE booking, always collect: the contact's name, email address, and what the meeting is about
- If you don't have their email, ask for it — you need it for the calendar invite
- After booking, ALWAYS create an appointment note summarising what the meeting is about and any context from the conversation
- Confirm the date, time, and purpose back to the contact after booking

## When You Don't Know the Answer
If a contact asks something you genuinely do not have the information for — do NOT guess, fabricate, or make up an answer. This is critical.
${(() => {
  if (!fallback) return '- Acknowledge that you don\'t have that information and offer to connect them with someone who does.'
  switch (fallback.behavior) {
    case 'transfer':
      return '- Immediately transfer the conversation to a human using the transfer_to_human tool. Do not attempt to answer.'
    case 'message_and_transfer':
      return `- Say: "${fallback.message || "That\'s a great question — let me connect you with someone who can help."}" and then use transfer_to_human to escalate.`
    case 'message':
    default:
      return `- Say: "${fallback.message || "That\'s a great question — let me find out and get back to you."}" Do not attempt to answer beyond this.`
  }
})()}

## Tone
Professional but warm. Match the contact's energy.`

  if (qualifyingBlock) {
    prompt += qualifyingBlock
  }

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
  conversationProviderId?: string
  channel?: string
  incomingMessage: string
  messageHistory?: Message[]
  systemPrompt?: string
  enabledTools?: string[]
  persona?: PersonaSettings
  fallback?: FallbackConfig
  qualifyingStyle?: 'strict' | 'natural'
  sandbox?: boolean
  // Optional injected CRM adapter — used by the widget runtime to route
  // sendMessage through SSE instead of GHL/HubSpot. When provided, this
  // overrides the default adapter lookup for the given locationId.
  adapter?: CrmAdapter
}): Promise<AgentResponse> {
  const { locationId, agentId, contactId, conversationId, conversationProviderId, channel = 'SMS', incomingMessage, messageHistory, systemPrompt, enabledTools, persona, fallback, qualifyingStyle, sandbox, adapter } = opts
  const isSandbox = sandbox || contactId.startsWith('playground-')

  // Resolve CRM adapter: explicit override > sandbox-null > default lookup
  const crm = adapter ?? (isSandbox ? null : await getCrmAdapter(locationId))

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
    content: `[Inbound ${channel} message from contact ${contactId}]: ${incomingMessage}`,
  })

  const actionsPerformed: string[] = []
  const toolCallTrace: ToolCallEntry[] = []
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let smsSent: string | null = null

  // Load qualifying questions for this agent
  // In sandbox: show all questions (no answer state to check)
  // In production: only show unanswered required questions
  let qualifyingBlock = ''
  if (agentId) {
    if (isSandbox) {
      const { getAllQuestions, buildQualifyingPromptBlock } = await import('./qualifying')
      const questions = await getAllQuestions(agentId)
      qualifyingBlock = buildQualifyingPromptBlock(questions, qualifyingStyle ?? 'strict')
    } else {
      const { getUnansweredQuestions, buildQualifyingPromptBlock } = await import('./qualifying')
      const unanswered = await getUnansweredQuestions(agentId, contactId)
      qualifyingBlock = buildQualifyingPromptBlock(unanswered, qualifyingStyle ?? 'strict')
    }
  }

  // Filter tools based on agent configuration
  // Normalize: ensure dependent tool pairs are always enabled together.
  //  - send_sms → send_reply (legacy back-compat)
  //  - get_available_slots ↔ book_appointment (so the agent can always
  //    actually commit a booking after reading slots)
  //  - book_appointment → get_available_slots (same reason, the other way)
  //  - book_appointment → create_appointment_note (so agent can log context)
  const normalizedTools = enabledTools
    ? [...new Set([
        ...enabledTools,
        ...(enabledTools.includes('send_sms') ? ['send_reply'] : []),
        ...(enabledTools.includes('get_available_slots') ? ['book_appointment'] : []),
        ...(enabledTools.includes('book_appointment') ? ['get_available_slots', 'create_appointment_note'] : []),
      ])]
    : undefined
  const tools = normalizedTools ? AGENT_TOOLS.filter(t => normalizedTools.includes(t.name)) : AGENT_TOOLS

  // Agentic loop — keeps going until Claude stops calling tools
  let currentMessages = [...messages]
  const MAX_ITERATIONS = 6
  const availableToolNames = tools.map(t => t.name)
  let hallucinationRetries = 0
  const MAX_HALLUCINATION_RETRIES = 2
  let forceToolNextIteration: string | null = null

  // ─── Decide initial tool_choice ───
  // If the inbound message strongly signals intent to book (and the booking
  // tools are available), force Claude to call A tool on the first turn.
  // This breaks the "let me check and get back to you" non-action reply.
  const incomingLower = (incomingMessage || '').toLowerCase()
  const BOOKING_INTENT_PATTERNS = [
    'speak to sales', 'talk to sales', 'book a call', 'book a meeting', 'book a demo',
    'schedule a call', 'schedule a meeting', 'schedule a demo', 'set up a call',
    'hop on a call', 'get on a call', 'have a call', 'have a meeting',
    'what times', 'available times', 'other times', 'another time', 'different time',
    'next available', 'whats next', "what's next", 'other options', 'something else',
    'have access to the calendar', 'check the calendar', 'any availability',
    'can we chat', 'quick chat', 'jump on', 'catch up',
    "i need another", 'need another time', 'need a different',
    "haven't heard", "havent heard", 'any update',
  ]
  const hasBookingIntent = BOOKING_INTENT_PATTERNS.some(p => incomingLower.includes(p))
  const hasBookingTools = availableToolNames.includes('get_available_slots') || availableToolNames.includes('book_appointment')
  const initialForceAny = hasBookingIntent && hasBookingTools

  if (initialForceAny) {
    console.log(`[Agent] Booking intent detected in "${incomingMessage?.slice(0, 60)}" — forcing tool_choice: any`)
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Compute tool_choice for THIS iteration
    let toolChoice: { type: string; name?: string } | undefined
    if (forceToolNextIteration) {
      toolChoice = { type: 'tool', name: forceToolNextIteration }
      console.log(`[Agent] Forcing specific tool: ${forceToolNextIteration}`)
      forceToolNextIteration = null
    } else if (i === 0 && initialForceAny) {
      toolChoice = { type: 'any' }
    }

    const createParams: any = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: buildSystemPrompt({ locationId, contactId } as AgentContext, systemPrompt, persona, qualifyingBlock, fallback, channel),
      tools,
      messages: currentMessages,
    }
    if (toolChoice) createParams.tool_choice = toolChoice

    const response = await client.messages.create(createParams)

    totalInputTokens += response.usage.input_tokens
    totalOutputTokens += response.usage.output_tokens

    // Process response content
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
    const textBlocks = response.content.filter(b => b.type === 'text')

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      // Done — extract any final text
      const finalText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n')

      // ─── Hallucination guardrail ───
      // Detect replies that CLAIM an action happened when the matching tool
      // was never called. Force the model to either call the tool or correct.
      const falseClaim = finalText
        ? detectFalseActionClaim(finalText, actionsPerformed, availableToolNames)
        : null
      if (falseClaim && hallucinationRetries < MAX_HALLUCINATION_RETRIES) {
        hallucinationRetries++
        console.warn(`[Agent] ⚠ Hallucination detected (retry ${hallucinationRetries}/${MAX_HALLUCINATION_RETRIES}):`,
          `claimed ${falseClaim.tool} without calling it. Reply: "${falseClaim.phrase}"`)
        // Force the specific tool on the next iteration — this physically
        // prevents Claude from ending the turn without calling it.
        if (falseClaim.tool && availableToolNames.includes(falseClaim.tool)) {
          forceToolNextIteration = falseClaim.tool
        }
        // Push the model's claim + a corrective user turn, then continue looping
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: falseClaim.correction },
        ]
        continue
      }
      if (falseClaim && hallucinationRetries >= MAX_HALLUCINATION_RETRIES) {
        // Out of retries — replace the lying reply with a safe fallback so we
        // don't send a fabricated confirmation to the contact.
        console.error(`[Agent] ❌ Hallucination persists after ${MAX_HALLUCINATION_RETRIES} retries. Replacing false claim.`)
        actionsPerformed.push(`hallucination_blocked:${falseClaim.tool}`)
        const fallbackText = safeFallbackReply(falseClaim)
        if (!smsSent && crm) {
          await crm.sendMessage({
            type: (channel || 'SMS') as import('@/types').MessageChannelType,
            contactId,
            conversationProviderId,
            message: fallbackText,
          })
          smsSent = fallbackText
          actionsPerformed.push(`send_reply (fallback, ${channel})`)
        }
        break
      }

      if (finalText && !smsSent) {
        // If Claude wrote a reply but didn't use send_reply, send it now on the correct channel
        let msgToSend = finalText
        if (persona?.simulateTypos) msgToSend = applyTypos(msgToSend)
        if (persona?.typingDelayEnabled) {
          const delay = calculateTypingDelay(msgToSend, persona.typingDelayMinMs, persona.typingDelayMaxMs)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        if (crm) {
          await crm.sendMessage({
            type: (channel || 'SMS') as import('@/types').MessageChannelType,
            contactId,
            conversationProviderId,
            message: msgToSend,
          })
        }
        smsSent = msgToSend
        actionsPerformed.push(`send_reply (auto, ${channel})`)
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
        agentId,
        channel,
        conversationProviderId,
        crm ?? undefined
      )
      toolCallTrace.push({
        tool: toolBlock.name,
        input: toolBlock.input as Record<string, unknown>,
        output: result,
        durationMs: Date.now() - toolStart,
      })

      // Track message sends (send_reply or legacy send_sms)
      if (toolBlock.name === 'send_reply' || toolBlock.name === 'send_sms') {
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
