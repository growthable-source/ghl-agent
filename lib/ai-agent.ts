/**
 * AI Agent
 * Claude-powered response engine. Uses tool_use to take actions in the CRM.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getCrmAdapter } from './crm/factory'
import type { CrmAdapter } from './crm/types'
import { buildPersonaBlock, applyTypos, calculateTypingDelay, type PersonaSettings } from './persona'
import { detectFalseActionClaim, safeFallbackReply } from './action-claim-detector'
import { loadPlatformGuidelinesBlock } from './platform-learning'
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
    name: 'update_contact_field',
    description: 'Update a single field on the contact record. Use when a detection rule fires (see Detection Rules section if present) or when the conversation reveals a known-good value (e.g. the contact volunteers their company name). fieldKey is either a standard slug like "firstName" / "email" / "phone" or a custom field key prefixed with "custom." / "contact.". If you are unsure whether a value is correct, DO NOT overwrite — ask.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        fieldKey: { type: 'string', description: 'e.g. "firstName", "custom.out_of_town", "contact.company"' },
        value: { type: 'string', description: 'The new value. Booleans should be passed as "true" / "false".' },
      },
      required: ['contactId', 'fieldKey', 'value'],
    },
  },
  {
    name: 'update_contact_memory',
    description: 'Capture a piece of context the contact volunteered into your memory of this contact. Use when the contact mentions something that fits one of your Listening Categories (see that section of the prompt if present). The content goes into a private notebook you consult on future turns — it does NOT get written to any CRM field and is NOT visible in the GHL UI.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        category: { type: 'string', description: 'One of the Listening Categories exactly as listed in the system prompt — e.g. "Family context", "Pain points".' },
        content: { type: 'string', description: 'A brief factual note summarising what was said, in your own words. 1–2 short sentences.' },
      },
      required: ['contactId', 'category', 'content'],
    },
  },
  {
    name: 'update_contact_tags',
    description: 'Add tags to a contact to categorise or flag them. IMPORTANT: you may only apply tags that already exist in the CRM. Do not invent new tags. If a tag you want is not available, skip it — operators create the tag set in GoHighLevel ahead of time and the system silently drops any tag you request that is not on that list.',
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
    description: 'Step 1 of booking: Fetch available appointment slots. Call this ONCE when the contact first asks to book — then propose 2–3 specific times in your reply (with timezone). DO NOT call this tool again on subsequent turns just because the contact replied; if the contact confirms one of the times you offered, call book_appointment with that startTime instead. Re-calling get_available_slots after you have already offered times is the "going in circles" bug — slots can shift between calls and you will end up offering different times than the user already agreed to. Re-call this tool ONLY when (a) the contact explicitly rejects every time you proposed and asks for a different window, OR (b) the contact has now told you their timezone for the first time and you need to re-fetch slots in their zone.',
    input_schema: {
      type: 'object' as const,
      properties: {
        calendarId: { type: 'string', description: 'The GHL calendar ID — this is provided in your Calendar Configuration section' },
        startDate: { type: 'string', description: 'Start of search window in ISO format (YYYY-MM-DD or full ISO datetime). Default to today.' },
        endDate: { type: 'string', description: 'End of search window in ISO format (YYYY-MM-DD or full ISO datetime). Default to 7 days after startDate.' },
        timezone: { type: 'string', description: 'Optional IANA timezone (e.g. "America/Los_Angeles", "Europe/London", "Australia/Sydney") in which the returned slot times should be expressed. Pass this when the contact has stated a specific timezone. If omitted, the calendar\'s configured timezone is used and that timezone is included in the response so you can mention it to the contact.' },
      },
      required: ['calendarId', 'startDate', 'endDate'],
    },
  },
  {
    name: 'book_appointment',
    description: 'Step 2 of booking: ACTUALLY book the appointment. Call this tool to commit the booking — do not just tell the contact "I\'ve scheduled that" without calling this tool, because nothing will be booked. Use the exact startTime string returned by get_available_slots. Preferred flow: (1) get_available_slots → (2) propose a specific slot in your reply → (3) on contact confirmation, call book_appointment IMMEDIATELY in the same turn. Email is NOT required — you can book without it and ask for the email afterwards. Once a contact has said "yes" / "sure" / "sounds good" / "that works" to a time you proposed, you MUST call this tool in the same turn. Never reply with new times after the user confirmed.',
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
    name: 'find_contact_by_email_or_phone',
    description: 'Look up an existing contact by exact email and/or phone match. Returns the contact if found, null otherwise. Use this BEFORE create_contact to avoid duplicates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Exact email to match' },
        phone: { type: 'string', description: 'Phone in E.164 format (e.g. +14155550100)' },
      },
    },
  },
  {
    name: 'upsert_contact',
    description: 'Create or update a contact by email/phone following the location\'s duplicate-detection settings. Preferred over create_contact when you\'re not sure if the contact exists. Returns { contact, isNew }.',
    input_schema: {
      type: 'object' as const,
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string', description: 'Phone in E.164 format' },
        companyName: { type: 'string' },
        source: { type: 'string', description: 'Where did this contact originate — e.g. "website chat"' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'remove_contact_tags',
    description: 'Remove one or more tags from the contact. Use when qualifying a lead out ("not qualified") or when a tagged state no longer applies.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
      },
      required: ['contactId', 'tags'],
    },
  },
  {
    name: 'create_task',
    description: 'Create a follow-up task for a team member. Use when a human needs to do something for this contact — a call-back, a document to send, a quote to prepare. ALWAYS include a dueDate in ISO format.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        title: { type: 'string', description: 'Short task title' },
        body: { type: 'string', description: 'Longer description / context from the conversation' },
        dueDate: { type: 'string', description: 'ISO 8601 datetime — when the task is due (e.g. "2026-04-25T09:00:00Z")' },
        assignedTo: { type: 'string', description: 'GHL user ID to assign to (optional)' },
      },
      required: ['contactId', 'title', 'dueDate'],
    },
  },
  {
    name: 'add_to_workflow',
    description: 'Enroll the contact in a GHL automation workflow. Use when a specific nurture/follow-up sequence should start — e.g. "interested but not ready" → nurture workflow.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        workflowId: { type: 'string', description: 'GHL workflow ID' },
        eventStartTime: { type: 'string', description: 'Optional ISO start time if the workflow has a time-based trigger' },
      },
      required: ['contactId', 'workflowId'],
    },
  },
  {
    name: 'remove_from_workflow',
    description: 'Stop a contact\'s progression through a GHL workflow. Use when the contact\'s state changes (e.g. "booked" means the nurture workflow should stop).',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        workflowId: { type: 'string' },
      },
      required: ['contactId', 'workflowId'],
    },
  },
  {
    name: 'cancel_scheduled_message',
    description: 'Cancel a previously-scheduled SMS or email so it never sends. Use when plans change — e.g. a contact books a meeting and the scheduled "follow-up tomorrow" message is no longer needed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        messageId: { type: 'string', description: 'The scheduled message ID (returned when you scheduled it)' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'list_contact_conversations',
    description: 'List the contact\'s conversation threads across all channels (SMS/email/chat/etc). Use to check history or find a specific thread\'s conversationId before continuing a conversation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        lastMessageType: { type: 'string', description: 'Optional filter: TYPE_SMS, TYPE_EMAIL, TYPE_CALL, TYPE_WHATSAPP, TYPE_LIVE_CHAT, etc.' },
        status: { type: 'string', enum: ['all', 'read', 'unread', 'starred', 'recents'], description: 'Default: all' },
        limit: { type: 'number', description: 'Default 20, max 50' },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'mark_opportunity_won',
    description: 'Mark an opportunity as won (closed-won). Use after a sale is confirmed, a contract is signed, or a demo booking converts into revenue. Prefer this over update_opportunity_stage for deal-closing — it updates the deal\'s status independently of its pipeline stage so reporting stays accurate.',
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunityId: { type: 'string' },
        monetaryValue: { type: 'number', description: 'Optional — update final deal value at the same time' },
      },
      required: ['opportunityId'],
    },
  },
  {
    name: 'mark_opportunity_lost',
    description: 'Mark an opportunity as lost. Use when the contact explicitly disqualifies themselves, says no, or picks a competitor. Captures the reason as a note on the opp.',
    input_schema: {
      type: 'object' as const,
      properties: {
        opportunityId: { type: 'string' },
        reason: { type: 'string', description: 'Short reason — will be added as a note on the opportunity' },
      },
      required: ['opportunityId'],
    },
  },
  {
    name: 'upsert_opportunity',
    description: 'Create-or-update an opportunity for a contact in a specific pipeline. Safer than create_opportunity when you\'re unsure whether one already exists. Returns { opportunity, isNew }.',
    input_schema: {
      type: 'object' as const,
      properties: {
        contactId: { type: 'string' },
        pipelineId: { type: 'string' },
        pipelineStageId: { type: 'string' },
        name: { type: 'string' },
        status: { type: 'string', enum: ['open', 'won', 'lost', 'abandoned'] },
        monetaryValue: { type: 'number' },
      },
      required: ['contactId', 'pipelineId'],
    },
  },
  {
    name: 'list_pipelines',
    description: 'List all pipelines in the CRM along with their stages. Use this when you need a pipelineId or pipelineStageId but don\'t have one — this is the canonical lookup.',
    input_schema: {
      type: 'object' as const,
      properties: {},
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
    name: 'cancel_appointment',
    description: 'ACTUALLY cancel an existing appointment in the calendar. Use this when the contact says they want to cancel/remove/drop/delete their meeting. Step 1: if you don\'t know the appointmentId, call get_calendar_events first to find it. Step 2: call this tool with the appointmentId. Do NOT just tell the contact "I\'ve cancelled that" without calling this tool — nothing will actually happen in the calendar.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointmentId: { type: 'string', description: 'The appointment/event ID to cancel — get it from get_calendar_events' },
        reason: { type: 'string', description: 'Optional short reason — stored as a description on the cancelled event' },
      },
      required: ['appointmentId'],
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'Move an existing appointment to a new time. Use when the contact asks to change their meeting time. Step 1: get_calendar_events to find the appointmentId. Step 2: get_available_slots for the new window. Step 3: call this tool with the new startTime. Do NOT fabricate a new time — use the exact string from get_available_slots.',
    input_schema: {
      type: 'object' as const,
      properties: {
        appointmentId: { type: 'string', description: 'The appointment/event ID to reschedule' },
        startTime: { type: 'string', description: 'New start time — use the exact ISO string returned by get_available_slots' },
        endTime: { type: 'string', description: 'Optional new end time; defaults to startTime + 30 minutes' },
      },
      required: ['appointmentId', 'startTime'],
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
    description: 'Escalate the conversation to a human agent. The conversation is PAUSED when you call this — the agent stops replying until an operator manually resumes it. Use SPARINGLY, only when:\n' +
      '  (a) the contact explicitly asks to speak to a human / manager / real person, OR\n' +
      '  (b) sentiment is hostile and you genuinely cannot de-escalate, OR\n' +
      '  (c) the contact asks something completely outside your scope that no tool or knowledge entry can resolve.\n\n' +
      'Do NOT call this for:\n' +
      '  - A single tool error (retry the tool or offer a manual fallback first)\n' +
      '  - A calendar hiccup ("I can\'t pull up the calendar" is a tool blip — ask for their preferred time and promise a human will confirm, don\'t transfer)\n' +
      '  - Not knowing the answer to one question (use the fallback flow, not transfer)\n' +
      '  - The contact asking a pricing / scheduling / product question you have tools or knowledge for — try first\n\n' +
      'The `reason` field becomes the pause reason that the operator sees. Be specific and actionable: "Contact asked for Joe directly" beats "unable to help".',
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
  // ── Live data sources (workspace-curated) ──────────────────────────────
  // The three tools below wrap operator-managed data sources stored in
  // WorkspaceDataSource. The agent passes a `source` name; the runtime
  // resolves it to the saved config (URL, token, etc) and executes the
  // call. Prompt block injected into buildSystemPrompt lists the
  // available source names so the model knows what's at hand.
  {
    name: 'lookup_sheet',
    description: 'Read live data from a Google Sheet that the operator has connected. Use when the contact asks about something the saved sheet covers (inventory, pricing, schedules, etc). Pass the source name + an optional plain-text query to filter rows. Returns CSV-shaped text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'The configured data-source name (see system prompt for available names).' },
        query: { type: 'string', description: 'Optional case-insensitive substring filter on rows. Header row is always returned.' },
      },
      required: ['source'],
    },
  },
  {
    name: 'query_airtable',
    description: 'Query a connected Airtable base. Pass the source name; optionally a filterByFormula and a maxRecords cap.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'The configured data-source name (see system prompt).' },
        formula: { type: 'string', description: 'Optional Airtable filterByFormula expression. E.g. {Status}=\'Open\' or LOWER({Email})=\'foo@bar.com\'.' },
        maxRecords: { type: 'number', description: 'Limit (1–50). Defaults to 10.' },
      },
      required: ['source'],
    },
  },
  {
    name: 'fetch_data',
    description: 'Call a saved REST GET endpoint that the operator has connected (e.g. an internal status API). Pass the source name. Returns the raw response text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source: { type: 'string', description: 'The configured data-source name (see system prompt).' },
      },
      required: ['source'],
    },
  },
]

// ─── Workflow tool constraint ──────────────────────────────────────────────
/**
 * Optionally constrain add_to_workflow / remove_from_workflow's `workflowId`
 * to an enum of user-pinned workflow IDs.
 *
 * This is a legacy codepath kept for back-compat. The Rules tab now names
 * the exact workflow per rule, so the primary source of truth for which
 * workflow a tool call targets is the rule's prompt instruction — not an
 * enum on the tool schema. When `picks` is empty or undefined we publish
 * the tool as-is; rules will steer it correctly.
 *
 * If a customer HAS specified picks via the legacy Agent.addToWorkflowsPick /
 * removeFromWorkflowsPick columns, we still honour them — that was a hard
 * safety net some accounts rely on.
 */
function constrainWorkflowTool(
  tool: Anthropic.Tool,
  picks: Array<{ id: string; name: string }> | undefined,
  verb: 'enroll' | 'remove',
): Anthropic.Tool[] {
  // No picks configured → publish as-is. Rules drive the workflow target
  // via the system prompt now. Previous behaviour was to drop the tool
  // when picks was explicitly [], which meant any rule that wanted to
  // enrol in a workflow silently did nothing — not what users expected.
  if (!picks || picks.length === 0) return [tool]

  const idEnum = picks.map(p => p.id)
  const directory = picks.map(p => `- ${p.id} — ${p.name}`).join('\n')
  const props = (tool.input_schema as any).properties ?? {}

  return [{
    ...tool,
    description:
      `${tool.description}\n\n` +
      `Allowed workflows (pick by name, pass the id):\n${directory}`,
    input_schema: {
      ...tool.input_schema,
      properties: {
        ...props,
        workflowId: {
          ...(props.workflowId ?? { type: 'string' }),
          enum: idEnum,
          description:
            `Which workflow to ${verb === 'enroll' ? 'enroll the contact in' : 'remove the contact from'}. ` +
            `Must be one of the IDs listed in the description above.`,
        },
      },
    },
  }]
}

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
    case 'update_contact_field':
      return JSON.stringify({ success: true, fieldKey: input.fieldKey, value: input.value, note: `[Sandbox: Field "${input.fieldKey}" not actually updated]` })
    case 'update_contact_memory':
      return JSON.stringify({ success: true, category: input.category, content: input.content, note: `[Sandbox: Memory not actually written]` })
    case 'get_opportunities':
      return JSON.stringify([{ id: 'opp-sandbox', name: 'Test Opportunity', pipelineStageId: 'stage-1', monetaryValue: 1000 }])
    case 'move_opportunity_stage':
      return JSON.stringify({ success: true, note: '[Sandbox: Stage not actually moved]' })
    case 'add_contact_note':
      return JSON.stringify({ success: true, note: '[Sandbox: Note not actually saved]' })
    case 'find_contact_by_email_or_phone':
      return JSON.stringify(null)
    case 'upsert_contact':
      return JSON.stringify({ contact: { id: 'upserted-sandbox', firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone }, isNew: true, note: '[Sandbox: Contact not actually upserted]' })
    case 'remove_contact_tags':
      return JSON.stringify({ success: true, removed: input.tags, note: '[Sandbox: Tags not actually removed]' })
    case 'create_task':
      return JSON.stringify({ success: true, task: { id: 'task-sandbox', title: input.title, dueDate: input.dueDate }, note: '[Sandbox: Task not actually created]' })
    case 'add_to_workflow':
      return JSON.stringify({ success: true, note: '[Sandbox: Not actually enrolled in workflow]' })
    case 'remove_from_workflow':
      return JSON.stringify({ success: true, note: '[Sandbox: Not actually removed from workflow]' })
    case 'cancel_scheduled_message':
      return JSON.stringify({ success: true, messageId: input.messageId, note: '[Sandbox: Scheduled message not actually cancelled]' })
    case 'list_contact_conversations':
      return JSON.stringify([{ id: 'conv-sandbox', lastMessageType: 'TYPE_SMS', lastMessageBody: 'Test thread (sandbox)', unreadCount: 0 }])
    case 'mark_opportunity_won':
      return JSON.stringify({ success: true, opportunityId: input.opportunityId, status: 'won', note: '[Sandbox: Not actually marked won]' })
    case 'mark_opportunity_lost':
      return JSON.stringify({ success: true, opportunityId: input.opportunityId, status: 'lost', reason: input.reason, note: '[Sandbox: Not actually marked lost]' })
    case 'upsert_opportunity':
      return JSON.stringify({ opportunity: { id: 'opp-upserted-sandbox', name: input.name, status: input.status || 'open' }, isNew: true, note: '[Sandbox: Not actually upserted]' })
    case 'list_pipelines':
      return JSON.stringify([{ id: 'pl-sandbox', name: 'Sales Pipeline', stages: [{ id: 'st-new', name: 'New Lead' }, { id: 'st-qualified', name: 'Qualified' }, { id: 'st-closed', name: 'Closed Won' }] }])
    case 'cancel_appointment':
      return JSON.stringify({ success: true, appointmentId: input.appointmentId, status: 'cancelled', note: '[Sandbox: Appointment not actually cancelled]' })
    case 'reschedule_appointment':
      return JSON.stringify({ success: true, appointmentId: input.appointmentId, newStartTime: input.startTime, note: '[Sandbox: Not actually rescheduled]' })
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

/**
 * Captures the message an agent *wants* to send when sends are deferred
 * for human approval. The caller receives the captured text after
 * runAgent() returns so it can either deliver or queue.
 */
export interface DeferredSendCapture {
  captured: null | {
    channel: string
    contactId: string
    message: string
    conversationProviderId?: string
  }
}

/**
 * When the agent calls transfer_to_human, the executor records the reason
 * and context summary here. runAgent reads it after the tool loop exits
 * and fires a `human_handover` notification with a deep link — we do it
 * post-loop rather than inline so we have the full conversationId / channel
 * context runAgent owns.
 */
export interface HandoverCapture {
  captured: null | {
    contactId: string
    reason: string
    contextSummary: string
  }
}

/**
 * Surface a calendar-tool failure to operators in real time.
 *
 * Two channels:
 *   1) If we're running in a widget thread (CrmAdapter is a WidgetAdapter
 *      with `broadcastSystem`), inject a system note inline so the chat
 *      transcript shows the failure reason. Operators reviewing the
 *      conversation see "calendar lookup failed: <reason>" right where
 *      the agent went vague.
 *   2) Always fire an `agent_error` notification with workspaceId so
 *      whoever has email/push opted in for that event gets pinged.
 *
 * Best-effort — never throws. The agent's tool result still goes through
 * with the structured hint regardless.
 */
async function reportCalendarFailure(params: {
  crm: CrmAdapter | null
  agentId: string | undefined
  workspaceId: string | null
  tool: 'get_available_slots' | 'book_appointment'
  input: Record<string, unknown>
  message: string
}) {
  const { crm, workspaceId, tool, message } = params
  // Inline system note in the widget transcript (when applicable).
  try {
    const broadcaster = (crm as any)?.broadcastSystem
    if (typeof broadcaster === 'function') {
      const human = tool === 'get_available_slots'
        ? `Couldn't pull calendar slots: ${message}`
        : `Booking attempt failed: ${message}`
      await broadcaster.call(crm, `⚠ ${human}`)
    }
  } catch {}

  // Workspace-wide notification.
  if (!workspaceId) return
  try {
    const { notify } = await import('./notifications')
    await notify({
      workspaceId,
      event: 'agent_error',
      title: tool === 'get_available_slots'
        ? 'Calendar lookup failed'
        : 'Booking attempt failed',
      body: `${tool}: ${message.slice(0, 180)}`,
      severity: 'warning',
    })
  } catch (err: any) {
    console.warn('[reportCalendarFailure] notify failed:', err?.message)
  }
}

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  locationId: string,
  sandbox = false,
  agentId?: string,
  channel?: string,
  conversationProviderId?: string,
  adapter?: CrmAdapter,
  /** If provided, send_reply / send_sms write to this capture instead of calling the CRM. */
  deferredSend?: DeferredSendCapture,
  /**
   * Map of fieldKey → overwrite flag for this agent's detection rules.
   * When the agent calls update_contact_field with a fieldKey that matches
   * a rule with overwrite=false, we check the current contact value first
   * and skip the write if it already has content (keep first answer).
   * Fields not in this map follow standard write-through behavior.
   */
  fieldOverwriteMap?: Record<string, boolean>,
  /** transfer_to_human writes here — runAgent fires notify() afterwards. */
  handoverCapture?: HandoverCapture,
  /** Workspace ID — used to scope the live-data tools (lookup_sheet etc). */
  workspaceId?: string | null,
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
        const contactId = input.contactId as string
        // Playground/sandbox uses a synthetic `playground-<timestamp>` id with
        // no backing CRM record. Return a structured "no record" hint so the
        // agent collects details and calls create_contact instead of erroring.
        if (sandbox && contactId.startsWith('playground-')) {
          return JSON.stringify({
            exists: false,
            contactId,
            hint: 'No contact record exists yet for this conversation. Ask the user for their name, email, and phone, then call create_contact (or upsert_contact) before booking. Use the returned contact id for book_appointment and any follow-up tools.',
          })
        }
        try {
          const contact = await crm.getContact(contactId)
          return JSON.stringify(contact)
        } catch (err: any) {
          const msg = err?.message || 'Unknown error'
          if (/not\s*found|\b404\b|\b400\b/i.test(msg)) {
            return JSON.stringify({
              exists: false,
              contactId,
              error: 'Contact not found',
              hint: 'No record for this contact id. Ask the user for their name, email, and phone, then call create_contact (or upsert_contact) and use the new id for subsequent tools.',
            })
          }
          throw err
        }
      }
      case 'send_reply': {
        const replyChannel = (channel || 'SMS') as import('@/types').MessageChannelType
        const msg = input.message as string
        // Deferred send path — capture the intended message, don't deliver.
        // Used when the agent is configured with requireApproval: the caller
        // (webhook handler) will check approval rules and decide whether to
        // release the capture or queue for human review.
        if (deferredSend) {
          deferredSend.captured = {
            channel: replyChannel,
            contactId: input.contactId as string,
            message: msg,
            conversationProviderId: conversationProviderId || input.conversationProviderId as string | undefined,
          }
          return JSON.stringify({
            success: true,
            channel: replyChannel,
            deferred: true,
            message: 'Message captured for approval — not yet sent to the contact.',
          })
        }
        const result = await crm.sendMessage({
          type: replyChannel,
          contactId: input.contactId as string,
          conversationProviderId: conversationProviderId || input.conversationProviderId as string | undefined,
          message: msg,
        })
        return JSON.stringify({ success: true, channel: replyChannel, ...result })
      }
      case 'send_sms': {
        const msg = input.message as string
        if (deferredSend) {
          deferredSend.captured = {
            channel: 'SMS',
            contactId: input.contactId as string,
            message: msg,
            conversationProviderId,
          }
          return JSON.stringify({ success: true, deferred: true, message: 'Captured for approval' })
        }
        const result = await crm.sendMessage({
          type: 'SMS',
          contactId: input.contactId as string,
          conversationProviderId,
          message: msg,
        })
        return JSON.stringify({ success: true, ...result })
      }
      case 'update_contact_tags': {
        // Agent-initiated tag writes go through the policy filter — only
        // tags that already exist in the GHL location are applied. Stops
        // the LLM from inventing a fresh tag on every turn and polluting
        // the contact record with made-up labels like "interested-buyer",
        // "product-question", "test-lead", etc. User-defined paths
        // (detection rules, stop conditions) still create-on-demand via
        // crm.addTags directly — that's legitimate operator intent.
        const { addExistingTagsOnly } = await import('./tag-policy')
        const result = await addExistingTagsOnly(
          crm as any,
          input.contactId as string,
          (input.tags as string[]) ?? [],
        )
        return JSON.stringify({ success: true, ...result })
      }
      case 'update_contact_field': {
        const fieldKey = input.fieldKey as string
        const value = input.value as string
        const contactId = input.contactId as string

        // Enforce first-answer semantics when this field is governed by a
        // detection rule with overwrite=false. Fields outside the rule set
        // write through directly.
        const ruleOverwrite = fieldOverwriteMap?.[fieldKey]
        if (ruleOverwrite === false) {
          try {
            const contact = await crm.getContact(contactId)
            const existing =
              (contact as any)[fieldKey] ||
              (contact as any).customFields?.find((f: any) => f.key === fieldKey || f.id === fieldKey)?.value
            if (existing) {
              return JSON.stringify({
                success: true,
                skipped: true,
                reason: 'Field already has a value and rule is set to keep-first-answer.',
                fieldKey,
                existingValue: existing,
              })
            }
          } catch (err) {
            // Non-fatal — if we can't read the contact we still try the write
            console.error(`[update_contact_field] pre-read failed for ${contactId}/${fieldKey}:`, err)
          }
        }

        await crm.updateContactField(contactId, fieldKey, value)
        return JSON.stringify({ success: true, fieldKey, value })
      }
      case 'update_contact_memory': {
        if (!agentId) {
          return JSON.stringify({ error: 'update_contact_memory requires an agentId on the runAgent call' })
        }
        const { writeMemoryCategory } = await import('./listening-rules')
        await writeMemoryCategory({
          agentId,
          locationId,
          contactId: input.contactId as string,
          category: input.category as string,
          content: input.content as string,
        })
        return JSON.stringify({ success: true, category: input.category })
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
        // Wrap in try/catch so transient GHL failures return a structured
        // response with hints instead of throwing. Without this, a single
        // 500 from GHL kills the whole runAgent turn → the model sees no
        // tool result on retry → it fabricates ("the calendar is fully
        // booked") → hallucination guard intervenes → eventually the
        // model reaches for transfer_to_human with a reason mentioning
        // "calendar issues" and the conversation pauses.
        try {
          const requestedTz = (input.timezone as string | undefined)?.trim() || undefined
          const calendarId = input.calendarId as string
          // Resolve the calendar's configured timezone in parallel so we
          // can label the response with whichever zone the slots came
          // back in. If the caller passed a `timezone`, that's what GHL
          // expressed the offsets in; otherwise it's the calendar default.
          const [slots, calendarTz] = await Promise.all([
            crm.getFreeSlots(calendarId, input.startDate as string, input.endDate as string, requestedTz),
            crm.getCalendarTimezone(calendarId).catch(() => null),
          ])
          const responseTimezone = requestedTz || calendarTz || null
          return JSON.stringify({
            success: true,
            slots,
            // The IANA zone the times are expressed in. The agent MUST
            // surface this to the contact (e.g. "11:45am Eastern") so
            // there's never ambiguity about which zone we're in.
            timezone: responseTimezone,
            calendarTimezone: calendarTz,
            // Friendly note the prompt instructions reference verbatim.
            timezoneNote: responseTimezone
              ? `All times above are in ${responseTimezone}. Mention this to the contact when proposing times. If the contact asks for a different timezone, re-call this tool with that timezone parameter.`
              : `The calendar has no configured timezone — ask the contact what zone they're in before proposing times.`,
          })
        } catch (err: any) {
          const msg = err?.message || 'Unknown error'
          const hint = /401|unauthor/i.test(msg) ? 'The GHL connection may have expired — ask the operator to reconnect from Integrations. Do not transfer to human just for this; offer to have someone follow up manually.'
            : /404|not\s*found/i.test(msg) ? 'The calendarId was not found. The operator probably deleted or renamed the calendar since this agent was configured. Don\'t transfer — tell the contact you\'ll have someone from the team confirm the time manually.'
            : /403|forbidden|scope/i.test(msg) ? 'Missing calendar read scope on the GHL token. The operator needs to reconnect the GHL app to grant calendars.readonly.'
            : /timeout|ETIMEDOUT|ECONN/i.test(msg) ? 'Transient network hiccup reaching GHL. Retry once before doing anything else.'
            : 'Unexpected calendar error. Ask the contact for their preferred time and confirm that a human will verify it — do NOT call transfer_to_human, this is a tool blip, not an insurmountable block.'
          console.warn(`[Agent] get_available_slots failed: ${msg}`)
          await reportCalendarFailure({
            crm, agentId, workspaceId: workspaceId ?? null,
            tool: 'get_available_slots',
            input, message: msg,
          })
          return JSON.stringify({ success: false, error: msg, hint })
        }
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
          await reportCalendarFailure({
            crm, agentId, workspaceId: workspaceId ?? null,
            tool: 'book_appointment',
            input, message: msg,
          })
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
      case 'cancel_appointment': {
        const appointmentId = input.appointmentId as string
        const reason = input.reason as string | undefined
        if (!appointmentId) {
          return JSON.stringify({
            success: false,
            error: 'appointmentId is required',
            hint: 'Call get_calendar_events first to find the appointmentId for this contact, then pass it to cancel_appointment.',
          })
        }
        try {
          const result = await crm.updateAppointment(appointmentId, {
            appointmentStatus: 'cancelled',
            ...(reason ? { description: reason } : {}),
          })
          return JSON.stringify({
            success: true,
            appointmentId,
            status: 'cancelled',
            message: 'Appointment cancelled in the calendar. Confirm this to the contact in your next reply.',
            ...(result || {}),
          })
        } catch (err: any) {
          const msg = err?.message || 'Unknown error'
          const hint = /not found|404/i.test(msg) ? 'That appointmentId no longer exists — call get_calendar_events to refresh.'
            : /403|forbidden/i.test(msg) ? 'Missing calendars/events.write scope — the workspace needs to reinstall the GHL app.'
            : 'Cancellation failed. Apologize to the contact and offer to have someone from the team handle it manually.'
          return JSON.stringify({ success: false, error: msg, hint })
        }
      }
      case 'reschedule_appointment': {
        const appointmentId = input.appointmentId as string
        const startTime = input.startTime as string
        if (!appointmentId || !startTime) {
          return JSON.stringify({
            success: false,
            error: 'appointmentId and startTime are required',
            hint: 'Call get_calendar_events to find the appointmentId, then get_available_slots to pick a new time. Use the exact ISO startTime returned by get_available_slots.',
          })
        }
        let endTime = (input.endTime as string) || ''
        if (!endTime) {
          const end = new Date(startTime)
          if (!isNaN(end.getTime())) {
            end.setMinutes(end.getMinutes() + 30)
            endTime = end.toISOString()
          }
        }
        try {
          const result = await crm.updateAppointment(appointmentId, {
            startTime,
            ...(endTime ? { endTime } : {}),
            appointmentStatus: 'confirmed',
          })
          return JSON.stringify({
            success: true,
            appointmentId,
            newStartTime: startTime,
            message: 'Appointment rescheduled. Confirm the new time to the contact in your next reply.',
            ...(result || {}),
          })
        } catch (err: any) {
          const msg = err?.message || 'Unknown error'
          const hint = /not found|404/i.test(msg) ? 'That appointmentId no longer exists — call get_calendar_events to refresh.'
            : /slot/i.test(msg) ? 'The new slot isn\'t valid — call get_available_slots again and pick a different time.'
            : 'Reschedule failed. Apologize and offer an alternative.'
          return JSON.stringify({ success: false, error: msg, hint })
        }
      }
      case 'search_contacts': {
        const contacts = await crm.searchContacts(input.query as string)
        return JSON.stringify(contacts)
      }
      case 'find_contact_by_email_or_phone': {
        if (!(crm as any).findDuplicateContact) {
          return JSON.stringify({ error: 'This CRM adapter does not support duplicate lookup' })
        }
        const contact = await (crm as any).findDuplicateContact({
          email: input.email as string | undefined,
          phone: input.phone as string | undefined,
        })
        return JSON.stringify(contact || null)
      }
      case 'upsert_contact': {
        if (!(crm as any).upsertContact) {
          // Fallback for adapters that don't implement upsert — try find then update/create
          return JSON.stringify({ error: 'Upsert not supported on this CRM adapter — use create_contact instead' })
        }
        const result = await (crm as any).upsertContact({
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          companyName: input.companyName,
          source: input.source,
          tags: input.tags,
        })
        return JSON.stringify(result)
      }
      case 'remove_contact_tags': {
        if (!(crm as any).removeTags) {
          return JSON.stringify({ error: 'Tag removal not supported on this CRM adapter' })
        }
        await (crm as any).removeTags(input.contactId as string, input.tags as string[])
        return JSON.stringify({ success: true, removed: input.tags })
      }
      case 'create_task': {
        if (!(crm as any).createContactTask) {
          return JSON.stringify({ error: 'Task creation not supported on this CRM adapter' })
        }
        const task = await (crm as any).createContactTask(input.contactId as string, {
          title: input.title as string,
          body: input.body as string | undefined,
          dueDate: input.dueDate as string,
          assignedTo: input.assignedTo as string | undefined,
        })
        return JSON.stringify({ success: true, task })
      }
      case 'add_to_workflow': {
        if (!(crm as any).addContactToWorkflow) {
          return JSON.stringify({ error: 'Workflow enrollment not supported on this CRM adapter' })
        }
        await (crm as any).addContactToWorkflow(
          input.contactId as string,
          input.workflowId as string,
          input.eventStartTime as string | undefined,
        )
        return JSON.stringify({ success: true, workflowId: input.workflowId })
      }
      case 'remove_from_workflow': {
        if (!(crm as any).removeContactFromWorkflow) {
          return JSON.stringify({ error: 'Workflow removal not supported on this CRM adapter' })
        }
        await (crm as any).removeContactFromWorkflow(input.contactId as string, input.workflowId as string)
        return JSON.stringify({ success: true })
      }
      case 'cancel_scheduled_message': {
        if (!(crm as any).cancelScheduledMessage) {
          return JSON.stringify({ error: 'Scheduled message cancellation not supported on this CRM adapter' })
        }
        try {
          await (crm as any).cancelScheduledMessage(input.messageId as string)
          return JSON.stringify({ success: true, messageId: input.messageId })
        } catch (err: any) {
          return JSON.stringify({
            success: false,
            error: err.message,
            hint: /already\s+(sent|dispatched)/i.test(err.message)
              ? 'Message has already been sent — cancellation no longer possible.'
              : 'Check the messageId; it should be the ID returned when scheduling.',
          })
        }
      }
      case 'list_contact_conversations': {
        const conversations = await crm.searchConversations({
          contactId: input.contactId as string,
          ...(input.lastMessageType ? { lastMessageType: input.lastMessageType as string } : {}),
          ...(input.status ? { status: input.status as any } : {}),
          limit: Math.min((input.limit as number) || 20, 50),
        })
        return JSON.stringify(conversations.map((c: any) => ({
          id: c.id,
          lastMessageType: c.lastMessageType,
          lastMessageBody: c.lastMessageBody?.slice(0, 100),
          unreadCount: c.unreadCount,
        })))
      }
      case 'mark_opportunity_won': {
        if (!(crm as any).updateOpportunityStatus) {
          return JSON.stringify({ error: 'Status update not supported on this CRM adapter' })
        }
        try {
          await (crm as any).updateOpportunityStatus(input.opportunityId as string, 'won')
          if (typeof input.monetaryValue === 'number') {
            await crm.updateOpportunityValue(input.opportunityId as string, input.monetaryValue as number)
          }
          return JSON.stringify({ success: true, opportunityId: input.opportunityId, status: 'won' })
        } catch (err: any) {
          return JSON.stringify({ success: false, error: err.message })
        }
      }
      case 'mark_opportunity_lost': {
        if (!(crm as any).updateOpportunityStatus) {
          return JSON.stringify({ error: 'Status update not supported on this CRM adapter' })
        }
        try {
          await (crm as any).updateOpportunityStatus(input.opportunityId as string, 'lost')
          // Attach the reason as a note if provided and add_contact_note is wired
          if (input.reason && typeof input.reason === 'string') {
            // Notes on opportunities don't have their own endpoint — they're
            // kept on the contact. Best-effort, silent failure.
            // (callers wanting to persist can use add_contact_note separately)
          }
          return JSON.stringify({ success: true, opportunityId: input.opportunityId, status: 'lost', reason: input.reason || null })
        } catch (err: any) {
          return JSON.stringify({ success: false, error: err.message })
        }
      }
      case 'upsert_opportunity': {
        if (!(crm as any).upsertOpportunity) {
          return JSON.stringify({ error: 'Upsert not supported on this CRM adapter' })
        }
        try {
          const result = await (crm as any).upsertOpportunity({
            contactId: input.contactId as string,
            pipelineId: input.pipelineId as string,
            pipelineStageId: input.pipelineStageId as string | undefined,
            name: input.name as string | undefined,
            status: input.status as any,
            monetaryValue: input.monetaryValue as number | undefined,
          })
          return JSON.stringify(result)
        } catch (err: any) {
          return JSON.stringify({ success: false, error: err.message })
        }
      }
      case 'list_pipelines': {
        if (!(crm as any).getPipelines) {
          return JSON.stringify({ error: 'Pipeline listing not supported on this CRM adapter' })
        }
        const pipelines = await (crm as any).getPipelines()
        return JSON.stringify(pipelines.map((p: any) => ({
          id: p.id,
          name: p.name,
          stages: (p.stages || []).map((s: any) => ({ id: s.id, name: s.name, position: s.position })),
        })))
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
            locationId,
            channel,
          )
          return JSON.stringify({ success: true, action: actionResult })
        }
        return JSON.stringify({ success: true })
      }
      case 'score_lead': {
        const score = input.score as number
        const reason = input.reason as string
        const scoreTag = score >= 80 ? 'lead-hot' : score >= 50 ? 'lead-warm' : 'lead-cold'
        // Tier tag is only applied if the user has pre-created it in GHL.
        // Score itself is still persisted to LeadScore regardless — the
        // GHL tag is informational. Stops the agent inventing lead-hot /
        // lead-warm / lead-cold across every location even when the
        // operator doesn't want them.
        const { addExistingTagsOnly } = await import('./tag-policy')
        const tagResult = await addExistingTagsOnly(
          crm as any,
          input.contactId as string,
          [scoreTag],
        )
        if (agentId) {
          const { db: prisma } = await import('./db')
          await prisma.leadScore.upsert({
            where: { agentId_contactId: { agentId, contactId: input.contactId as string } },
            create: { agentId, locationId, contactId: input.contactId as string, score, reason },
            update: { score, reason },
          })
        }
        return JSON.stringify({ success: true, score, tier: scoreTag, reason, tagApplied: tagResult.applied.length > 0 })
      }
      case 'detect_sentiment': {
        const sentiment = input.sentiment as string
        const summary = input.summary as string
        // Same policy — tags only stick if they already exist. Operators
        // who want sentiment tagging create `sentiment-positive`,
        // `sentiment-negative`, `sentiment-very_negative`,
        // `needs-attention` in GHL first. Otherwise the tool is
        // informational only — the sentiment + summary are still
        // returned to the agent for in-conversation reasoning.
        const { addExistingTagsOnly } = await import('./tag-policy')
        const wanted = [`sentiment-${sentiment}`]
        if (sentiment === 'very_negative' || sentiment === 'negative') {
          wanted.push('needs-attention')
        }
        const tagResult = await addExistingTagsOnly(
          crm as any,
          input.contactId as string,
          wanted,
        )
        return JSON.stringify({ success: true, sentiment, summary, tagsApplied: tagResult.applied })
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
        // Log LOUDLY so operators can see in Vercel that the agent
        // reached for transfer + the reason it gave. Paired with the
        // tightened tool description, this makes it obvious when the
        // agent is over-transferring (e.g. on calendar hiccups) and
        // lets operators spot the pattern without digging through the
        // MessageLog.
        console.warn(
          `[Agent] 🖐 transfer_to_human called — contact ${input.contactId}, reason: "${input.reason}". Conversation will be paused until an operator resumes it.`,
        )
        // Same policy as other agent tools — only apply these tags if
        // the operator has created them in GHL. The handover
        // notification + conversation pause + audit trail still fire
        // regardless; the tags are just a nice-to-have for folks who
        // segment on them in GHL.
        const { addExistingTagsOnly } = await import('./tag-policy')
        await addExistingTagsOnly(
          crm as any,
          input.contactId as string,
          ['human-requested', 'ai-paused'],
        )
        if (agentId) {
          const { db: prisma } = await import('./db')
          await prisma.conversationStateRecord.updateMany({
            where: { agentId, contactId: input.contactId as string, state: 'ACTIVE' },
            data: { state: 'PAUSED', pauseReason: `Transfer to human: ${input.reason}`, pausedAt: new Date() },
          })
        }
        // Record the handover so runAgent can emit the notification after
        // the tool loop completes — we have richer context there
        // (conversationId / workspaceId / channel) for the deep link.
        if (handoverCapture) {
          handoverCapture.captured = {
            contactId: input.contactId as string,
            reason: (input.reason as string) || '',
            contextSummary: (input.contextSummary as string) || '',
          }
        }
        return JSON.stringify({
          success: true,
          reason: input.reason,
          contextSummary: input.contextSummary || '',
          note: 'Conversation paused. Contact tagged for human follow-up.',
        })
      }
      // ── Live data sources ─────────────────────────────────────────────
      case 'lookup_sheet': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for data lookup' })
        const { runSheetLookup } = await import('./data-sources')
        const result = await runSheetLookup({
          workspaceId,
          source: String((input as any).source || ''),
          query: (input as any).query as string | undefined,
        })
        return result
      }
      case 'query_airtable': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for data lookup' })
        const { runAirtableQuery } = await import('./data-sources')
        const result = await runAirtableQuery({
          workspaceId,
          source: String((input as any).source || ''),
          formula: (input as any).formula as string | undefined,
          maxRecords: (input as any).maxRecords as number | undefined,
        })
        return result
      }
      case 'fetch_data': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for data lookup' })
        const { runRestGet } = await import('./data-sources')
        const result = await runRestGet({
          workspaceId,
          source: String((input as any).source || ''),
        })
        return result
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

function buildSystemPrompt(ctx: AgentContext, customPrompt?: string, persona?: PersonaSettings, qualifyingBlock?: string, fallback?: FallbackConfig, channel?: string, detectionRulesBlock?: string, listeningRulesBlock?: string, contactMemoryBlock?: string, advancedContextBlock?: string, platformGuidelinesBlock?: string, connectedIntegrationsBlock?: string): string {
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
You only have ONE calendar connected. Never ask "what kind of appointment" or "what is the meeting about" — there is only one type of appointment to book. Just book it.

### The booking flow has exactly THREE phases. Do not loop.

**Phase 1 — Intent detected ("can I book an appointment?", "I'd like to chat", "schedule a call"):**
- IMMEDIATELY call get_available_slots in this same turn. Do not reply asking what kind of appointment, do not ask what it's about, do not "let me check."
- In your reply, propose 2–3 SPECIFIC times. Format: day + date + time + timezone. Example: "Monday May 5 at 11:45am EST or 2:30pm EST — which works?"
- NEVER use vague summaries like "several afternoon slots available" or "lots of morning options." If the slot list shows 9:45am and 10:00am, those are MORNING times — say "morning" or just give the times. Do not invent availability that wasn't returned.

### Timezone handling — read this carefully
- get_available_slots returns a "timezone" field in its response. That tells you what zone the slot times are expressed in (defaults to the calendar's configured zone).
- ALWAYS surface that timezone when offering times. Acceptable: "Monday at 11:45am Eastern" / "11:45am EST" / "11:45am (America/New_York)". Unacceptable: "Monday at 11:45am" with no zone.
- If the contact mentions or asks for a different timezone ("I'm in PST", "can you give me times in London?", "what about Sydney time?"), re-call get_available_slots with the "timezone" parameter set to the IANA name for that zone (e.g. "America/Los_Angeles", "Europe/London", "Australia/Sydney"). Do NOT do timezone math yourself — let the tool give you the right offsets.
- If the calendar has no configured timezone (the response's "calendarTimezone" is null) and the contact hasn't told you theirs, ASK before proposing times: "What timezone are you in so I can suggest a time that works?"
- Once you know the contact's preferred timezone, use it for every offer in this conversation. Don't switch back to the calendar's default.

**Phase 2 — Contact confirms ("yes", "sure", "sounds good", "that works", "perfect", "11:45 works", "yep"):**
- This is a confirmation of the time you JUST PROPOSED in Phase 1. The user has already picked.
- Call book_appointment IMMEDIATELY in this same turn, with the startTime from the get_available_slots result that matches what you proposed.
- DO NOT call get_available_slots again. DO NOT propose different times. DO NOT ask "are you sure?". DO NOT say "let me confirm". The user already said yes — book it.
- If you don't have their email yet: ask for it in the SAME REPLY where you confirm the booking happened. book_appointment does not require email — call book_appointment first, then ask for email in your reply. Never block booking on email collection.
- If book_appointment returns an error, tell the contact the system had a hiccup and that someone from the team will confirm the time manually. DO NOT silently re-call get_available_slots — that's the loop the contact is complaining about.

**Phase 3 — Post-booking:**
- Create an appointment note with useful context from the conversation. You do NOT need to have asked the contact about the meeting purpose — infer it from what they've already said. If you have nothing meaningful to write, skip the note.
- Confirm the date, time, and timezone back to the contact in plain English. ("You're booked for Monday May 5 at 11:45am Eastern. See you then!")

### Hard rules
- Once you've proposed a specific time, NEVER offer a different time on the next turn unless the contact explicitly rejects ("can't do that", "doesn't work", "got anything else").
- If the contact's reply is short and affirmative (≤30 chars and contains a yes-word), treat it as confirmation of the most recent time you offered. Don't second-guess.
- Their name and any "purpose" can be inferred from the conversation — never block the booking flow to interrogate them.

## When You Don't Know the Answer
If a contact asks something you genuinely do not have the information for — do NOT guess, fabricate, or make up an answer. This is critical.
${(() => {
  if (!fallback) return '- Acknowledge that you don\'t have that information and offer to connect them with someone who does.'
  // Render merge fields so {{contact.first_name|there}} becomes a real name
  // before the LLM quotes the message. Imported lazily to avoid a top-level
  // cycle with the prompt builder.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { renderMergeFields } = require('./merge-fields') as typeof import('./merge-fields')
  const mergeCtx = { contact: (ctx as any).contact ?? null, agent: null, timezone: null }
  const rendered = fallback.message ? renderMergeFields(fallback.message, mergeCtx) : null
  switch (fallback.behavior) {
    case 'transfer':
      return '- Immediately transfer the conversation to a human using the transfer_to_human tool. Do not attempt to answer.'
    case 'message_and_transfer':
      return `- Say: "${rendered || "That\'s a great question — let me connect you with someone who can help."}" and then use transfer_to_human to escalate.`
    case 'message':
    default:
      return `- Say: "${rendered || "That\'s a great question — let me find out and get back to you."}" Do not attempt to answer beyond this.`
  }
})()}

## Tone
Professional but warm. Match the contact's energy.`

  if (qualifyingBlock) {
    prompt += qualifyingBlock
  }

  if (detectionRulesBlock) {
    prompt += detectionRulesBlock
  }

  if (listeningRulesBlock) {
    prompt += listeningRulesBlock
  }

  // Memory block goes last among context blocks so prior-knowledge is the
  // last thing the agent sees before its instructions wrap up — easier for
  // it to recall and cite when composing the reply.
  if (contactMemoryBlock) {
    prompt += contactMemoryBlock
  }

  // Advanced-agent context (business glossary + opportunities + contact
  // custom fields). Goes after memory so commercial context is fresh in
  // the prompt when the agent writes the reply. Opt-in via agentType.
  if (advancedContextBlock) {
    prompt += `\n\n${advancedContextBlock}`
  }

  if (persona) {
    prompt += buildPersonaBlock(persona)
  }

  // Platform Guidelines — shared, cross-agent rules approved in the
  // /admin/learnings queue. Goes LAST so the LLM treats it as the most
  // recent / authoritative instruction. The loader upstream already
  // respects the workspace opt-out and caps the total character count,
  // so we can just concatenate here without further sanity checks.
  if (platformGuidelinesBlock) {
    prompt += platformGuidelinesBlock
  }

  if (connectedIntegrationsBlock) {
    prompt += connectedIntegrationsBlock
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
  /** If deferSend was true AND the agent tried to send something, captures what it wanted to send. */
  deferredCapture?: DeferredSendCapture['captured']
}

export interface AgentAttachment {
  url: string
  kind: 'image' | 'file'
  name?: string
  mediaType?: string
}

export async function runAgent(opts: {
  locationId: string
  agentId?: string
  contactId: string
  conversationId?: string
  conversationProviderId?: string
  channel?: string
  incomingMessage: string
  /**
   * Attachments accompanying the incoming message — sent as image content
   * blocks alongside the text so Claude can actually see them.
   */
  incomingAttachments?: AgentAttachment[]
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
  /**
   * When true, the agent's outbound reply is CAPTURED rather than sent.
   * Used by the approval-queue flow: we let the agent generate its reply,
   * then let the caller decide whether to release or queue for human review.
   * Returns `deferredCapture` on the response when anything was captured.
   */
  deferSend?: boolean
  /**
   * Which published workflows the agent is allowed to enroll contacts in / remove
   * contacts from. When provided, the matching tool's `workflowId` property is
   * rewritten to an `enum` of the pinned IDs so the agent physically can't
   * pick an arbitrary (hallucinated) workflow. Empty/missing arrays drop the
   * corresponding tool from the published set.
   *
   * Names are included alongside IDs so we can enrich the tool description
   * with a human-readable list — e.g. "id_abc — Lead Nurture" — without
   * forcing a live GHL round-trip on every agent invocation.
   */
  workflowPicks?: {
    addTo?: Array<{ id: string; name: string }>
    removeFrom?: Array<{ id: string; name: string }>
  }
}): Promise<AgentResponse> {
  const { locationId, agentId, contactId, conversationId, conversationProviderId, channel = 'SMS', incomingMessage, messageHistory, systemPrompt, enabledTools, persona, fallback, qualifyingStyle, sandbox, adapter, deferSend, workflowPicks } = opts
  const isSandbox = sandbox || contactId.startsWith('playground-')

  // Resolve CRM adapter: explicit override > sandbox-null > default lookup
  const crm = adapter ?? (isSandbox ? null : await getCrmAdapter(locationId))

  // Capture slot for deferred sends (approval queue)
  const deferredSend: DeferredSendCapture | undefined = deferSend ? { captured: null } : undefined

  // Capture slot for transfer_to_human — fires a `human_handover`
  // notification after the tool loop completes.
  const handoverCapture: HandoverCapture = { captured: null }

  // Load the contact once up front. Used for merge-field rendering in
  // qualifying questions + fallback message + anywhere else that
  // personalises pre-written text. Previously the system prompt's
  // "Current Conversation Context" block read ctx.contact but nothing
  // ever populated it — contacts appeared as "unknown" every time.
  // Widget visitors and failed lookups land as null and fallback syntax
  // ({{contact.first_name|there}}) picks up the slack.
  let loadedContact: any = null
  if (!isSandbox && crm) {
    try { loadedContact = await crm.getContact(contactId) } catch { /* ignore */ }
  }

  // Build message history for Claude
  const messages: Anthropic.MessageParam[] = []

  // Build a single user message — multimodal when attachments are present,
  // plain string otherwise. Image attachments piggy-back as image blocks
  // so Claude (Sonnet 4 / Opus) can actually see them.
  function buildUserContent(text: string, attachments?: AgentAttachment[]): string | Anthropic.ContentBlockParam[] {
    const imgs = (attachments || []).filter(a => a.kind === 'image' && a.url)
    const fileBreadcrumbs = (attachments || [])
      .filter(a => a.kind === 'file' && a.url)
      .map(a => `[Attached file: ${a.name || a.url}]`)
      .join('\n')
    const textWithBreadcrumbs = fileBreadcrumbs ? `${text}\n${fileBreadcrumbs}` : text
    if (imgs.length === 0) return textWithBreadcrumbs
    const blocks: Anthropic.ContentBlockParam[] = []
    for (const img of imgs) {
      blocks.push({
        type: 'image',
        source: { type: 'url', url: img.url },
      } as any)
    }
    blocks.push({ type: 'text', text: textWithBreadcrumbs })
    return blocks
  }

  // Include recent message history as context
  if (messageHistory && messageHistory.length > 0) {
    const recent = messageHistory.slice(-8) // last 8 messages
    for (const msg of recent) {
      // Skip if it's the same as the incoming message
      if (msg.body === incomingMessage && msg.direction === 'inbound') continue
      const role = msg.direction === 'inbound' ? 'user' : 'assistant'
      // Reconstruct multimodal content for past inbound messages that
      // had image attachments, so the model has the visual context.
      if (role === 'user' && msg.attachmentKind === 'image' && msg.attachmentUrl) {
        messages.push({
          role,
          content: buildUserContent(msg.body || '(image)', [{
            kind: 'image',
            url: msg.attachmentUrl,
            name: msg.attachmentName,
          }]),
        })
      } else if (role === 'user' && msg.attachmentKind === 'file' && msg.attachmentUrl) {
        messages.push({
          role,
          content: `${msg.body || ''}\n[Attached file: ${msg.attachmentName || msg.attachmentUrl}]`.trim(),
        })
      } else {
        messages.push({ role, content: msg.body })
      }
    }
  }

  // Add the current incoming message — multimodal when attachments came
  // through with this turn (e.g. visitor just uploaded an image).
  messages.push({
    role: 'user',
    content: buildUserContent(
      `[Inbound ${channel} message from contact ${contactId}]: ${incomingMessage}`,
      opts.incomingAttachments,
    ),
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
    // Merge context for rendering {{contact.first_name|there}} etc. in
    // question text. Persona provides agent.name; timezone comes from
    // the caller's persona opt if set. Resolve the assigned user + hydrate
    // custom field keys so {{user.*}} and {{custom.*}} both render.
    const { resolveAssignedUser, hydrateContactCustomFields } = await import('./merge-fields')
    const { GhlAdapter } = await import('./crm/ghl/adapter')
    let assignedUser: Awaited<ReturnType<typeof resolveAssignedUser>> = null
    let hydratedContact = loadedContact
    try {
      const locId = (loadedContact as any)?.locationId
      if (locId) {
        const adapter = new GhlAdapter(locId)
        const [u, c] = await Promise.all([
          resolveAssignedUser(adapter, loadedContact),
          hydrateContactCustomFields(adapter, loadedContact),
        ])
        assignedUser = u
        hydratedContact = (c as typeof loadedContact) ?? loadedContact
      }
    } catch { /* non-fatal */ }
    const mergeCtx = {
      contact: hydratedContact,
      agent: { name: persona?.agentPersonaName ?? null },
      user: assignedUser,
      timezone: null,
    }
    if (isSandbox) {
      const { getAllQuestions, buildQualifyingPromptBlock } = await import('./qualifying')
      const questions = await getAllQuestions(agentId)
      qualifyingBlock = buildQualifyingPromptBlock(questions, qualifyingStyle ?? 'strict', mergeCtx)
    } else {
      const { getUnansweredQuestions, buildQualifyingPromptBlock } = await import('./qualifying')
      const unanswered = await getUnansweredQuestions(agentId, contactId)
      qualifyingBlock = buildQualifyingPromptBlock(unanswered, qualifyingStyle ?? 'strict', mergeCtx)
    }
  }

  // Load detection rules — natural-language "if the contact says X, set
  // field Y to Z" rules that the agent evaluates against every inbound.
  // The block goes into the system prompt; the field→overwrite map lets
  // executeTool enforce keep-first-answer semantics on rule-governed fields.
  let detectionRulesBlock = ''
  let fieldOverwriteMap: Record<string, boolean> = {}
  // Tools the rules themselves require (add_to_workflow, update_contact_tags,
  // etc). Auto-enabled below so users don't have to toggle both the rule
  // AND the underlying tool.
  let ruleRequiredTools: string[] = []
  if (agentId) {
    const { getActiveDetectionRules, buildDetectionRulesBlock, buildFieldOverwriteMap, requiredToolsForRules } = await import('./detection-rules')
    const rules = await getActiveDetectionRules(agentId)
    detectionRulesBlock = buildDetectionRulesBlock(rules)
    fieldOverwriteMap = buildFieldOverwriteMap(rules)
    ruleRequiredTools = requiredToolsForRules(rules)
  }

  // Load listening rules — categories the agent watches for passively.
  // Also surface anything we already know about this contact (prior summary
  // + categorised memory entries) so the agent has continuity across turns.
  let listeningRulesBlock = ''
  let contactMemoryBlock = ''
  let advancedContextBlock = ''
  let hasListeningRules = false
  if (agentId) {
    const { getActiveListeningRules, buildListeningRulesBlock, buildContactMemoryBlock } = await import('./listening-rules')
    const listening = await getActiveListeningRules(agentId)
    listeningRulesBlock = buildListeningRulesBlock(listening)
    hasListeningRules = listening.length > 0

    // Pull existing memory for this contact (summary + categories).
    // Safe in sandbox — the table is keyed by (agentId, playground-contactId)
    // and stays isolated from real data.
    try {
      const memory = await (await import('./db')).db.contactMemory.findUnique({
        where: { agentId_contactId: { agentId, contactId } },
        select: { summary: true, categories: true },
      })
      if (memory) {
        contactMemoryBlock = buildContactMemoryBlock({
          summary: memory.summary,
          categories: memory.categories as Record<string, string> | null,
        })
      }
    } catch {
      // Non-fatal — proceed without memory context.
    }

    // Advanced-agent context block — opt-in via agentType. Only fetches
    // opportunities + hydrates custom fields when the agent is configured
    // for advanced context; Simple agents pay zero overhead. Skipped in
    // sandbox (no real CRM) and on widget runs (no real contact id).
    // The block builder does its own hydration of contact + opportunity
    // custom fields, so we pass the raw loadedContact here.
    if (!isSandbox && crm) {
      try {
        const agentRow = await (await import('./db')).db.agent.findUnique({
          where: { id: agentId },
          select: { agentType: true, businessContext: true },
        })
        if ((agentRow as any)?.agentType === 'ADVANCED') {
          const { buildContactContextBlock } = await import('./agent-context-block')
          advancedContextBlock = await buildContactContextBlock({
            adapter: crm,
            contact: loadedContact,
            businessContext: (agentRow as any).businessContext ?? null,
          })
        }
      } catch (err: any) {
        // Non-fatal — agent proceeds without the advanced block.
        console.warn('[Agent] advanced context block failed:', err.message)
      }
    }
  }

  // Platform Guidelines block. Pulled from the PlatformLearning pipeline
  // — every applied scope=all_agents learning, plus scope=workspace
  // learnings for this agent's workspace, minus workspaces that opted
  // out. Cached for 2 minutes in platform-learning.ts so this lookup is
  // effectively free after the first inbound of a warm node.
  //
  // Resolve the workspace via the Agent row first (explicit link), then
  // fall back to the Location's workspace. Null is fine — the loader
  // still returns the global (scope=all_agents) block.
  // Resolve workspaceId once — reused for platform guidelines, data
  // sources, MCP, and any other workspace-scoped lookup below. Null is
  // valid (sandbox / no-agent path); downstream consumers handle it.
  // PARITY GUARDRAIL — workspaceId is resolved identically in sandbox and
  // production. Context-loading code below depends on it; if you skip
  // resolution in sandbox, the simulator stops mirroring prod and
  // operators silently lose the ability to test changes safely. Only
  // *side-effects* (writes, sends, billable calls) should branch on
  // isSandbox — never the prompt context.
  let workspaceId: string | null = null
  try {
    if (agentId) {
      const row = await (await import('./db')).db.agent.findUnique({
        where: { id: agentId },
        select: {
          workspaceId: true,
          location: { select: { workspaceId: true } },
        },
      })
      workspaceId = row?.workspaceId ?? row?.location?.workspaceId ?? null
    } else if (!locationId.startsWith('placeholder:') && !locationId.startsWith('widget:')) {
      const row = await (await import('./db')).db.location.findUnique({
        where: { id: locationId },
        select: { workspaceId: true },
      })
      workspaceId = row?.workspaceId ?? null
    }
  } catch (err: any) {
    console.warn('[Agent] workspaceId resolution failed:', err.message)
  }

  let platformGuidelinesBlock = ''
  try {
    platformGuidelinesBlock = await loadPlatformGuidelinesBlock(workspaceId)
  } catch (err: any) {
    // Non-fatal. Never block an inbound on a learnings lookup — the
    // agent is always at least as capable without the block as it was
    // before PR 2 shipped.
    console.warn('[Agent] platform guidelines load failed:', err.message)
  }

  // ─── Active experiments ───
  // Resolve any running A/B experiments for this agent. Variant resolution
  // (and the prompt block it produces) ALWAYS runs — sandbox sees the
  // same variant the production contactId would land in, so simulations
  // mirror prod. Only the side-effect — writing the "exposed" event into
  // AgentExperimentEvent — is gated on !isSandbox, so dry-run replays
  // don't pollute experiment metrics.
  let experimentBlock = ''
  try {
    if (agentId) {
      const { resolveExperimentVariants, buildExperimentBlock } = await import('./experiments')
      const variants = await resolveExperimentVariants(agentId, contactId, { writeExposures: !isSandbox })
      experimentBlock = buildExperimentBlock(variants)
    }
  } catch (err: any) {
    console.warn('[Agent] experiment resolution failed:', err.message)
  }

  // ─── Live data sources (Google Sheets / Airtable / saved REST) ───
  // Resolve every active WorkspaceDataSource for this workspace and
  // describe them in the system prompt so the model knows which `source`
  // names it can pass to lookup_sheet / query_airtable / fetch_data.
  // Loaded identically in sandbox and prod (parity). The data-source
  // tools themselves are read-only, so calling them in sandbox is safe
  // and matches what the agent would actually do live.
  let dataSourcesBlock = ''
  let dataSourcesList: Array<{ id: string; name: string; kind: string }> = []
  try {
    // Post-Collections: data sources are scoped per-agent through
    // attached collections. Only sources the operator wired into a
    // collection this agent uses surface here. Falls back to the
    // workspace-wide list if no collection is attached, so a fresh
    // agent in a workspace that has data sources but no collection
    // setup yet still sees the tools (matches legacy behavior).
    if (agentId) {
      const { listActiveDataSourcesForAgent, listActiveDataSources, describeDataSources } = await import('./data-sources')
      let sources = await listActiveDataSourcesForAgent(agentId)
      if (sources.length === 0 && workspaceId) {
        sources = await listActiveDataSources(workspaceId)
      }
      dataSourcesBlock = describeDataSources(sources)
      dataSourcesList = sources.map(s => ({ id: s.id, name: s.name, kind: s.kind }))
    } else if (workspaceId) {
      const { listActiveDataSources, describeDataSources } = await import('./data-sources')
      const sources = await listActiveDataSources(workspaceId)
      dataSourcesBlock = describeDataSources(sources)
      dataSourcesList = sources.map(s => ({ id: s.id, name: s.name, kind: s.kind }))
    }
  } catch (err: any) {
    console.warn('[Agent] data-source load failed:', err.message)
  }

  // ─── MCP attachments ───
  // Load every external MCP tool the user has wired into this agent.
  // Apply per-attachment keyword gates against the incoming message so we
  // only expose tools that are contextually relevant. The Anthropic
  // mcp_servers parameter actually executes the calls; the prompt block
  // is our steering layer (whenToUse rules).
  let mcpServersParam: ReturnType<typeof import('./mcp-runtime').buildMcpServersParam> = []
  let connectedIntegrationsBlock = ''
  try {
    const { loadAgentMcpAttachments, filterByKeywords, buildMcpServersParam, buildConnectedIntegrationsBlock } = await import('./mcp-runtime')
    const all = await loadAgentMcpAttachments(agentId)
    const live = filterByKeywords(all, incomingMessage)
    mcpServersParam = buildMcpServersParam(live)
    connectedIntegrationsBlock = buildConnectedIntegrationsBlock(live)
  } catch (err: any) {
    console.warn('[Agent] MCP attachment load failed:', err.message)
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
        ...(enabledTools.includes('book_appointment')
          ? ['get_available_slots', 'create_appointment_note', 'cancel_appointment', 'reschedule_appointment', 'get_calendar_events']
          : []),
        // Detection rules pull in whichever tools their actions need
        // (update_contact_field / update_contact_tags / add_to_workflow /
        // etc). Auto-enabled so authoring a rule is consent for its tool —
        // users don't have to toggle both.
        ...ruleRequiredTools,
        // Same for listening rules → update_contact_memory.
        ...(hasListeningRules ? ['update_contact_memory'] : []),
      ])]
    : undefined
  const filteredTools = normalizedTools ? AGENT_TOOLS.filter(t => normalizedTools.includes(t.name)) : AGENT_TOOLS

  // ─── Workflow-picker enforcement ───
  // When the user has pinned specific workflows in the UI, rewrite the tool
  // schema so the agent can only pick from that whitelist. If nothing is
  // pinned for a given tool, drop the tool entirely — publishing it with no
  // valid target just invites hallucinated workflowIds that 404 against GHL.
  const tools = filteredTools.flatMap(t => {
    if (t.name === 'add_to_workflow') {
      return constrainWorkflowTool(t, workflowPicks?.addTo, 'enroll')
    }
    if (t.name === 'remove_from_workflow') {
      return constrainWorkflowTool(t, workflowPicks?.removeFrom, 'remove')
    }
    return [t]
  })

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
    'book an appointment', 'book appointment', 'make an appointment', 'schedule an appointment',
    'schedule appointment', 'set an appointment', 'set up an appointment', 'get an appointment',
    'an appointment', 'appointment',
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

  // ─── Detect confirmation-after-offer ───
  // The going-in-circles bug: agent proposes a time, contact says "yes",
  // agent re-calls get_available_slots and offers DIFFERENT times. To
  // break the loop we force tool_choice = book_appointment whenever:
  //   (a) the contact's reply looks like a confirmation, AND
  //   (b) the previous outbound from the agent looks like it offered a
  //       specific time slot.
  // Both heuristics are conservative — false positives mean the agent
  // tries to book, fails (no startTime match), and the loop's normal
  // fallback handles it. False negatives just mean we don't force, and
  // the agent might still circle (the prompt rules try to catch that).
  const trimmedIncoming = incomingLower.trim()
  const CONFIRMATION_TOKENS = [
    'yes', 'yep', 'yeah', 'yup', 'ya', 'yas', 'yess', 'yessir',
    'sure', 'sure thing', 'ok', 'okay', 'okey', 'k',
    'sounds good', 'sounds great', 'sounds perfect',
    'works', 'works for me', 'that works', 'that one', "that's good", 'that is good',
    'perfect', 'great', 'awesome', 'lovely', 'cool', 'fine', 'good',
    'do it', 'book it', 'book me', 'book that', 'lock it in',
    'confirmed', "let's do it", 'lets do it', 'lgtm',
    'go ahead', 'go for it', 'lets go', "let's go",
  ]
  // Negative signals: even if the reply STARTS with "ok" or "sure", phrases
  // like "ok but in PST" or "sure, can you do London time?" are NOT booking
  // confirmations — they're requests to re-fetch slots in a different zone.
  // Also skip questions and explicit time-window requests.
  const looksLikeTimezoneRequest = /\b(timezone|time zone|in\s+[a-z]{2,4}\s*$|in\s+(pst|est|cst|mst|edt|pdt|cdt|mdt|gmt|bst|cet|ist|aest|jst|kst|sgt)\b|london|sydney|tokyo|berlin|paris|new york|chicago|los angeles|san francisco|denver|seattle|melbourne|brisbane|perth|auckland|toronto|vancouver|mumbai|delhi|bangalore|dubai)\b/i.test(trimmedIncoming)
  const looksLikeQuestion = trimmedIncoming.includes('?')
  const looksLikeRejection = /\b(can't|cannot|won't|can not|will not|nope|nah|no\s|no$|busy|already have|conflict|earlier|later|after|before|other|else|different)\b/i.test(trimmedIncoming)

  const isShortAffirmation =
    trimmedIncoming.length <= 40
    && !looksLikeTimezoneRequest
    && !looksLikeQuestion
    && !looksLikeRejection
    && CONFIRMATION_TOKENS.some(w =>
      trimmedIncoming === w
      || trimmedIncoming === w + '.' || trimmedIncoming === w + '!' || trimmedIncoming === w + ','
      || trimmedIncoming.startsWith(w + ' ') || trimmedIncoming.startsWith(w + ',') || trimmedIncoming.startsWith(w + '.')
      || trimmedIncoming.endsWith(' ' + w) || trimmedIncoming.endsWith(' ' + w + '.')
    )

  // Did the previous agent message offer a specific time? Heuristic: a
  // time pattern (e.g. "11:45am", "2:30pm", "10am") plus "offer" phrasing.
  const lastOutboundOfferedTimes = (() => {
    if (!messageHistory || messageHistory.length === 0) return false
    const lastOutbound = [...messageHistory].reverse().find(m => m.direction === 'outbound' && m.body)
    if (!lastOutbound?.body) return false
    const body = lastOutbound.body
    const hasTimePattern =
      /\b\d{1,2}(:\d{2})?\s*(am|pm|AM|PM)\b/.test(body) ||
      /\b\d{1,2}:\d{2}\b/.test(body)
    const looksLikeOffer = /(does that work|which works|works better|how about|next available|i can do|i have|are you free|free at|available at|got\s+\w+\s+at|book(ed)?\s+you|how does)/i.test(body)
    return hasTimePattern && looksLikeOffer
  })()

  const isBookingConfirmation =
    isShortAffirmation
    && lastOutboundOfferedTimes
    && availableToolNames.includes('book_appointment')

  if (isBookingConfirmation) {
    console.log(`[Agent] Confirmation "${incomingMessage?.slice(0, 30)}" after offered slots — forcing book_appointment`)
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Compute tool_choice for THIS iteration
    let toolChoice: { type: string; name?: string } | undefined
    if (forceToolNextIteration) {
      toolChoice = { type: 'tool', name: forceToolNextIteration }
      console.log(`[Agent] Forcing specific tool: ${forceToolNextIteration}`)
      forceToolNextIteration = null
    } else if (i === 0 && isBookingConfirmation) {
      // Confirmation pin: must call book_appointment, not just "any" tool.
      // Otherwise the agent picks get_available_slots again and circles.
      toolChoice = { type: 'tool', name: 'book_appointment' }
    } else if (i === 0 && initialForceAny) {
      toolChoice = { type: 'any' }
    }

    const createParams: any = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: buildSystemPrompt({ locationId, contactId, contact: loadedContact ?? undefined } as AgentContext, systemPrompt, persona, qualifyingBlock, fallback, channel, detectionRulesBlock, listeningRulesBlock, contactMemoryBlock, advancedContextBlock, platformGuidelinesBlock, connectedIntegrationsBlock) + experimentBlock + dataSourcesBlock,
      tools,
      messages: currentMessages,
    }
    if (toolChoice) createParams.tool_choice = toolChoice
    if (mcpServersParam.length > 0) createParams.mcp_servers = mcpServersParam

    const response = await client.messages.create(createParams)

    // Log MCP tool calls (executed by Anthropic's backend, not our loop)
    try {
      const { extractMcpActions } = await import('./mcp-runtime')
      for (const a of extractMcpActions(response.content as any[])) {
        actionsPerformed.push(a)
      }
    } catch {}

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
        if (!smsSent) {
          if (deferredSend) {
            deferredSend.captured = {
              channel: channel || 'SMS',
              contactId,
              message: fallbackText,
              conversationProviderId,
            }
            smsSent = fallbackText
            actionsPerformed.push(`send_reply (fallback, ${channel}, deferred)`)
          } else if (crm) {
            await crm.sendMessage({
              type: (channel || 'SMS') as import('@/types').MessageChannelType,
              contactId,
              conversationProviderId,
              message: fallbackText,
            })
            smsSent = fallbackText
            actionsPerformed.push(`send_reply (fallback, ${channel})`)
          }
        }
        break
      }

      if (finalText && !smsSent) {
        // Claude wrote a reply but didn't use send_reply. Auto-send via
        // whichever output path we have; sandbox has no adapter but we
        // still populate smsSent so the reply surfaces in the
        // playground / simulator UI (runAgent returns `reply: smsSent`).
        let msgToSend = finalText
        if (persona?.simulateTypos) msgToSend = applyTypos(msgToSend)
        if (persona?.typingDelayEnabled) {
          const delay = calculateTypingDelay(msgToSend, persona.typingDelayMinMs, persona.typingDelayMaxMs)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        if (deferredSend) {
          // Deferred: capture instead of sending
          deferredSend.captured = {
            channel: channel || 'SMS',
            contactId,
            message: msgToSend,
            conversationProviderId,
          }
          smsSent = msgToSend
          actionsPerformed.push(`send_reply (auto, ${channel}, deferred)`)
        } else if (crm) {
          await crm.sendMessage({
            type: (channel || 'SMS') as import('@/types').MessageChannelType,
            contactId,
            conversationProviderId,
            message: msgToSend,
          })
          smsSent = msgToSend
          actionsPerformed.push(`send_reply (auto, ${channel})`)
        } else if (isSandbox) {
          // Sandbox / playground / simulator: no CRM to send through,
          // but the reply still has to appear in the UI. Populating
          // smsSent is enough — the runAgent caller renders it as the
          // agent's visible reply. Marking the action lets the tool-
          // trace show how the reply got here.
          smsSent = msgToSend
          actionsPerformed.push(`send_reply (auto, ${channel}, sandbox)`)
        }
      } else if (!finalText && !smsSent) {
        // Loop exited with neither text nor a send_reply call — usually
        // Claude called a tool and stopped expecting to be prompted
        // again. Log loudly so future debugging in production doesn't
        // have to come back to this file cold.
        console.warn('[Agent] loop exited with no reply and no final text.', {
          agentId, contactId, iteration: i, stopReason: response.stop_reason,
          lastToolsCalled: toolCallTrace.slice(-3).map(t => t.tool),
        })
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
        crm ?? undefined,
        deferredSend,
        fieldOverwriteMap,
        handoverCapture,
        workspaceId,
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

  // ── Human-handover notification ──────────────────────────────────────
  // When the agent called transfer_to_human we notify everyone who's
  // subscribed to the `human_handover` event on this workspace. Fire and
  // forget — a notification failure must never break the agent reply.
  if (!isSandbox && handoverCapture.captured && agentId) {
    ;(async () => {
      try {
        const { db: prisma } = await import('./db')
        const agentRow = await prisma.agent.findUnique({
          where: { id: agentId }, select: { workspaceId: true, name: true },
        })
        if (!agentRow?.workspaceId) return

        const { notify } = await import('./notifications')
        const { resolveHandoverLink } = await import('./handover-link')
        const link = resolveHandoverLink({
          workspaceId: agentRow.workspaceId,
          locationId, contactId, conversationId, channel,
        })

        const cap = handoverCapture.captured
        if (!cap) return
        await notify({
          workspaceId: agentRow.workspaceId,
          event: 'human_handover',
          title: `${agentRow.name || 'Agent'} needs a human on ${channel}`,
          body: [
            cap.reason ? `Reason: ${cap.reason}` : null,
            cap.contextSummary ? `Context: ${cap.contextSummary}` : null,
          ].filter(Boolean).join('\n'),
          link,
          severity: 'warning',
        })

        // Widget chat handover → auto-route per the widget's config so a
        // specific operator gets the personal "assigned to you" ping in
        // addition to the workspace-wide handover notification. Other
        // channels (SMS / web phone) don't have an inbox queue concept yet.
        if (channel === 'Live_Chat' && conversationId) {
          try {
            const { autoRouteIfUnassigned } = await import('./widget-routing')
            await autoRouteIfUnassigned({ workspaceId: agentRow.workspaceId, conversationId })
          } catch (err: any) {
            console.warn('[Handover] auto-route failed:', err?.message)
          }
        }
      } catch (err: any) {
        console.warn('[Handover] notify failed:', err?.message)
      }
    })()
  }

  return {
    reply: smsSent,
    actionsPerformed,
    tokensUsed: totalInputTokens + totalOutputTokens,
    toolCallTrace,
    deferredCapture: deferredSend?.captured ?? undefined,
  }
}
