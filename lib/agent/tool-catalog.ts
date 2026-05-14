/**
 * Tool catalog — pure data describing every tool the agent can invoke.
 *
 * Lifted out of lib/ai-agent.ts. No logic — just JSON Schemas, the
 * read-only allowlist used by the sandbox, and the workflow-picker
 * helper that rewrites add_to_workflow / remove_from_workflow's
 * `workflowId` into an enum constrained to user-pinned IDs.
 */

import type Anthropic from '@anthropic-ai/sdk'

export const AGENT_TOOLS: Anthropic.Tool[] = [
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
    description: 'Add tags to a contact to categorise or flag them. IMPORTANT: you may only apply tags that already exist in the CRM. Do not invent new tags. If a tag you want is not available, skip it — operators create the tag set in the CRM ahead of time and the system silently drops any tag you request that is not on that list.',
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
    name: 'end_conversation',
    description: 'Close out a live-chat conversation. Use this when the visitor has gotten what they came for and the thread is naturally done — they said "thanks, that\'s all", confirmed an order was found, accepted a follow-up via email, etc. Closing the chat:\n' +
      '  - Stops you from replying further on this thread\n' +
      '  - Triggers the visitor\'s "rate this chat" prompt in the widget\n' +
      '  - Marks the conversation resolved in the operator inbox\n\n' +
      'Do NOT call this:\n' +
      '  - Mid-conversation when the visitor might still need help\n' +
      '  - Right after handing off to a human (transfer_to_human already pauses you; the human decides when it\'s really done)\n' +
      '  - On a non-widget channel (SMS, email, voice) — this tool is widget-only and will return an error elsewhere\n\n' +
      'Send your final reply with send_reply FIRST (a goodbye, recap, or thank-you), THEN call end_conversation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description: 'One-sentence summary of how the chat resolved. Visible to the operator in the inbox. Examples: "Customer found order #1042, no action needed.", "Visitor opted in for our newsletter and left."',
        },
      },
      required: ['summary'],
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

  // ─── Shopify (commerce) ──────────────────────────────────────────
  // All four return JSON payloads with the live store data. The
  // descriptions push the model HARD toward calling these before
  // discussing products — hallucinated SKUs/prices are the failure
  // mode we're trying to kill.
  {
    name: 'search_shopify_products',
    description: 'Search the connected Shopify store catalogue by free text (product name, type, vendor, tag, or SKU substring). Returns up to `limit` matching products with title, handle, description, price range, total inventory, and per-variant stock. ALWAYS call this BEFORE answering any customer question about what the store sells, what something costs, sizes available, or whether something is in stock. Never invent product details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Free-text search. Examples: "socks", "wool hat", "nike", "tag:summer-sale".' },
        limit: { type: 'number', description: 'Max products to return (1-25). Defaults to 10.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'check_shopify_inventory',
    description: 'Get the live stock level for a single product variant, broken down by fulfilment location. Use this when the customer asks about a specific size/colour combination — pass the variantId returned from search_shopify_products. Do NOT guess stock levels.',
    input_schema: {
      type: 'object' as const,
      properties: {
        variantId: {
          type: 'string',
          description: 'Full Shopify variant GID, e.g. "gid://shopify/ProductVariant/123456". Get this from search_shopify_products.variants[].id.',
        },
      },
      required: ['variantId'],
    },
  },
  {
    name: 'lookup_shopify_customer',
    description: 'Find a Shopify customer by email OR phone. Returns lifetime spend, order count, tags, and the 5 most recent orders with status. Use to personalise replies for repeat buyers. Returns null if the customer is not in Shopify — treat that as a new customer and do not fabricate purchase history.',
    input_schema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Customer email. Provide this OR phone (or both).' },
        phone: { type: 'string', description: 'Customer phone in any format Shopify recognises (E.164 preferred). Provide this OR email.' },
      },
      required: [],
    },
  },
  {
    name: 'check_shopify_order_status',
    description: 'Look up a Shopify order by its order name (e.g. "#1042"). Returns fulfilment status, tracking number + URL, line items, and total. Use whenever a customer asks "where\'s my order?" — never guess a status or tracking number.',
    input_schema: {
      type: 'object' as const,
      properties: {
        orderName: { type: 'string', description: 'The order name as the customer sees it. Accepts "#1042" or "1042" — the leading # is auto-added.' },
      },
      required: ['orderName'],
    },
  },
  {
    name: 'create_shopify_checkout',
    description: 'Build a Shopify draft order and return a hosted checkout URL the customer can pay on directly. Use only after confirming the items + quantities with the customer. Variants must be IDs returned by search_shopify_products — do not pass invented IDs.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lineItems: {
          type: 'array',
          description: 'Items to add to the checkout. 1-10 items.',
          items: {
            type: 'object',
            properties: {
              variantId: { type: 'string', description: 'Full Shopify variant GID, e.g. "gid://shopify/ProductVariant/123".' },
              quantity: { type: 'number', description: 'Whole-number quantity, minimum 1.' },
            },
            required: ['variantId', 'quantity'],
          },
        },
        customerEmail: { type: 'string', description: 'Optional — pre-fills the checkout email field. Use when you have a confirmed email for the customer.' },
        discountCode: { type: 'string', description: 'Optional — an existing Shopify discount code to apply. Use the exact code, e.g. "HELLO10".' },
        note: { type: 'string', description: 'Optional internal note attached to the draft order (visible to the merchant, not the customer).' },
      },
      required: ['lineItems'],
    },
  },
  {
    name: 'create_shopify_discount',
    description: 'Create a real Shopify discount code. Returns the code (which you can mention in your reply) and the expiry time. Keep discounts sensible — 5-15%% off, single-use, 24-72h expiry unless authorised otherwise. Pick a short memorable code.',
    input_schema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string', description: 'Code the customer will type at checkout. 4-20 chars, alphanumeric. Examples: "HELLO10", "SAVE15".' },
        type: { type: 'string', enum: ['percentage', 'fixed_amount'], description: '"percentage" or "fixed_amount".' },
        value: { type: 'number', description: 'For percentage: the percent (e.g. 10 = 10% off). For fixed_amount: the money amount in the shop currency (e.g. 5 = $5 off).' },
        usageLimit: { type: 'number', description: 'Cap total redemptions. Default 1 (single-use).' },
        expiresInHours: { type: 'number', description: 'Hours from now until expiry. Default 72.' },
      },
      required: ['code', 'type', 'value'],
    },
  },
  {
    name: 'record_back_in_stock_interest',
    description: 'Save the customer\'s interest in an out-of-stock variant. When stock returns, the system DMs them automatically. Call this whenever a customer asks about a product the live store says is OOS — promise the follow-up in your reply, then call this so the promise is actually kept.',
    input_schema: {
      type: 'object' as const,
      properties: {
        variantId: { type: 'string', description: 'Full Shopify variant GID, e.g. "gid://shopify/ProductVariant/123". From search_shopify_products or check_shopify_inventory.' },
        productTitle: { type: 'string', description: 'Product title as you\'d describe it to the customer in the follow-up message, e.g. "Essential Everyday Tote".' },
        variantTitle: { type: 'string', description: 'Optional variant qualifier ("Black / Medium") to disambiguate in the follow-up. Omit when the product has only one variant.' },
      },
      required: ['variantId', 'productTitle'],
    },
  },
]

// Read-only tools are safe to run against the real CRM even in the
// playground — they don't change state, and mocking them makes the
// playground useless for testing calendar availability, opportunity
// lookups, contact details, etc. The agent sees REAL data and reasons
// correctly about it.
export const SAFE_READ_ONLY_TOOLS = new Set([
  'get_contact_details',
  'get_opportunities',
  'get_available_slots',
  'get_calendar_events',
  'search_contacts',
  // Shopify commerce reads — pure GraphQL queries, no mutations.
  'search_shopify_products',
  'check_shopify_inventory',
  'lookup_shopify_customer',
  'check_shopify_order_status',
])

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
export function constrainWorkflowTool(
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
