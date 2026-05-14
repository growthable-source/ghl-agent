/**
 * Single source of truth for the agent's tool catalog.
 *
 * Two categories:
 *   • REFLEX — the tool the model is allowed to call freely during a
 *     conversation. Reads, replies, calendar coordination, handover.
 *     The operator chooses whether to enable each one (defaults are
 *     sensible) but doesn't author a "when" — the model decides.
 *
 *   • PLAY  — a write-action the model is NOT allowed to invoke
 *     directly. It only fires when an operator-authored Play matches.
 *     Examples: change pipeline stage, set deal value, enrol in a
 *     workflow. The deterministic rule engine fires these AFTER the
 *     model's reply, when the trigger conditions match. See the
 *     Playbook page for editing.
 *
 * The split is deliberate: read tools are benign and the model needs
 * them as primitives; write tools mutate CRM state and should never
 * fire on the model's discretion.
 *
 * The Reflex side is keyed by the same string the model receives in
 * its tool-use schema (see lib/ai-agent.ts AGENT_TOOLS). The Play side
 * is keyed by the AgentRule.actionType enum string — a different
 * identifier, since rule actions are executed by the deterministic
 * rule engine, not the model.
 */

// ─── Reflexes (model-callable tools) ─────────────────────────────────────────

export type ReflexGroup = 'messaging' | 'contacts' | 'pipeline' | 'calendar' | 'memory' | 'commerce'

export interface ReflexDef {
  key: string
  label: string
  description: string
  group: ReflexGroup
  /**
   * Reflexes the model needs to function are listed but cannot be
   * disabled by the operator (they're disabled-toggle in the UI). E.g.
   * `send_reply` — without it the agent literally cannot reply.
   */
  required?: boolean
}

// Tool keys flagged `required: true` in REFLEXES below — exported as a
// memoised set so the agent runtime can force-include them in every
// agent's tools array regardless of the operator's enabledTools.
// Without this, an old agent missing 'send_reply' (because the field
// existed before send_reply was required) ends up with no reply tool
// and Claude falls back to emitting `<invoke name="send_reply">` XML
// as plain chat text. That's the failure mode QA caught with
// "Shopify tool puts HTML in the chat."
export const REQUIRED_TOOL_KEYS = ['send_reply', 'transfer_to_human'] as const

export const REFLEXES: ReflexDef[] = [
  // Messaging — how the agent talks
  {
    key: 'send_reply',
    label: 'Send reply',
    description: 'Reply on the current channel (SMS, WhatsApp, Facebook, Instagram, Live Chat). Always on — the agent can\'t talk without it.',
    group: 'messaging',
    required: true,
  },
  {
    key: 'send_sms',
    label: 'Send SMS',
    description: 'Send an SMS directly. Prefer Send Reply for auto-channel detection.',
    group: 'messaging',
  },
  {
    key: 'send_email',
    label: 'Send email',
    description: 'Send an email to the contact.',
    group: 'messaging',
  },
  {
    key: 'cancel_scheduled_message',
    label: 'Cancel scheduled message',
    description: 'Cancel an SMS/email the agent had scheduled for later.',
    group: 'messaging',
  },
  {
    key: 'list_conversations',
    label: 'List conversations',
    description: 'List the contact\'s conversation threads filtered by channel/status.',
    group: 'messaging',
  },

  // Contacts — reading + lightweight context
  {
    key: 'get_contact_details',
    label: 'Get contact details',
    description: 'Look up the contact\'s info, tags, and source.',
    group: 'contacts',
  },
  {
    key: 'search_contacts',
    label: 'Search contacts',
    description: 'Search for contacts by name, email, or phone.',
    group: 'contacts',
  },
  {
    key: 'find_contact_by_email_or_phone',
    label: 'Find contact by email/phone',
    description: 'Look up an existing contact by exact email/phone match — used before creating a new one to avoid duplicates.',
    group: 'contacts',
  },
  {
    key: 'add_contact_note',
    label: 'Add contact note',
    description: 'Add a free-form note to the contact record. The agent uses this to capture context worth surfacing in the CRM.',
    group: 'contacts',
  },
  {
    key: 'update_contact_memory',
    label: 'Capture context',
    description: 'Save a piece of context the contact volunteered (family, pain points, etc.) into the agent\'s private notes — separate from the CRM.',
    group: 'memory',
  },

  // Pipeline — read only on the Reflex side. Mutations live in Playbook.
  {
    key: 'get_opportunities',
    label: 'Get opportunities',
    description: 'Fetch active pipeline opportunities for the contact.',
    group: 'pipeline',
  },
  {
    key: 'list_pipelines',
    label: 'List pipelines',
    description: 'Get all pipelines and their stages — used to look up stage IDs.',
    group: 'pipeline',
  },

  // Calendar — coordination needs conversation context, so these are reflex.
  {
    key: 'get_available_slots',
    label: 'Get available slots',
    description: 'Fetch available appointment slots so the agent can propose times.',
    group: 'calendar',
  },
  {
    key: 'book_appointment',
    label: 'Book appointment',
    description: 'Book the time the contact agreed to. Reflexive because the matching slot only exists in conversation context.',
    group: 'calendar',
  },
  {
    key: 'get_calendar_events',
    label: 'Get scheduled appointments',
    description: 'List the contact\'s upcoming appointments.',
    group: 'calendar',
  },
  {
    key: 'cancel_appointment',
    label: 'Cancel appointment',
    description: 'Cancel a meeting when the contact asks. Required for reliable cancellations — without it, the agent will say "I\'ve cancelled" without actually cancelling.',
    group: 'calendar',
  },
  {
    key: 'reschedule_appointment',
    label: 'Reschedule appointment',
    description: 'Move a meeting to a new time when the contact asks.',
    group: 'calendar',
  },
  {
    key: 'create_appointment_note',
    label: 'Add appointment note',
    description: 'Attach context from the conversation to the booked appointment.',
    group: 'calendar',
  },

  // Handover / scheduling
  {
    key: 'schedule_followup',
    label: 'Schedule a follow-up',
    description: 'Schedule a future check-in when the agent commits to one.',
    group: 'messaging',
  },
  {
    key: 'transfer_to_human',
    label: 'Transfer to human',
    description: 'Hand the conversation to a teammate when the agent decides it should.',
    group: 'messaging',
  },
  {
    key: 'end_conversation',
    label: 'Close live chat',
    description: 'Mark a widget conversation resolved when the visitor is done — triggers the rating prompt and removes the thread from active queues. Widget-only.',
    group: 'messaging',
  },

  // Commerce (Shopify). Only useful when the workspace has a Shopify
  // store connected; the dispatcher returns a friendly "no store
  // connected" message otherwise. The system prompt instructs the
  // agent to ALWAYS query before discussing products — no hallucinated
  // SKUs, prices, or stock levels.
  {
    key: 'search_shopify_products',
    label: 'Search products (Shopify)',
    description: 'Search the Shopify catalogue by free text (name, type, vendor, tag). Returns matching products with prices, total inventory, and per-variant stock. Use this BEFORE answering any question about what the store sells, what something costs, or whether something is in stock.',
    group: 'commerce',
  },
  {
    key: 'check_shopify_inventory',
    label: 'Check inventory (Shopify)',
    description: 'Get the live inventory count for a single product variant (by Shopify variant ID returned from Search products). Breaks down stock per fulfilment location. Use when the customer asks about a specific size/colour/SKU.',
    group: 'commerce',
  },
  {
    key: 'lookup_shopify_customer',
    label: 'Look up customer (Shopify)',
    description: 'Find a Shopify customer by email or phone. Returns lifetime spend, order count, tags, and the 5 most recent orders with fulfilment status. Use to personalise replies for repeat buyers — never invent past purchases the customer didn\'t actually make.',
    group: 'commerce',
  },
  {
    key: 'check_shopify_order_status',
    label: 'Check order status (Shopify)',
    description: 'Look up a Shopify order by order number (e.g. "#1042"). Returns fulfilment status, tracking number + URL, line items, and total. Use whenever a customer asks "where\'s my order?".',
    group: 'commerce',
  },
  {
    key: 'create_shopify_checkout',
    label: 'Create checkout link (Shopify)',
    description: 'Build a Shopify draft order with chosen variants and return a hosted checkout URL the customer can pay on directly. Use when the customer has decided what they want — confirm the items + quantities first, then call this and send the link.',
    group: 'commerce',
  },
  {
    key: 'create_shopify_discount',
    label: 'Create discount code (Shopify)',
    description: 'Mint a real Shopify discount code on the fly — for save-the-sale, loyalty, or win-back. Keep discounts sensible (5–15% off, single-use, 24–72h expiry) unless the operator has explicitly authorised more.',
    group: 'commerce',
  },
  {
    key: 'record_back_in_stock_interest',
    label: 'Record back-in-stock interest (Shopify)',
    description: 'Save the customer\'s interest in an OOS variant. When stock returns, the system DMs them automatically. Use whenever a customer asks about a product that\'s out of stock — promise the follow-up, then call this so it actually happens.',
    group: 'commerce',
  },
]

export const REFLEX_GROUP_LABEL: Record<ReflexGroup, string> = {
  messaging: 'Messaging',
  contacts: 'Contacts',
  pipeline: 'Pipeline',
  calendar: 'Calendar',
  memory: 'Memory',
  commerce: 'Commerce',
}

export const REFLEX_GROUP_ORDER: ReflexGroup[] = [
  'messaging', 'contacts', 'calendar', 'pipeline', 'commerce', 'memory',
]

// ─── Plays (deterministic actions) ───────────────────────────────────────────

export type PlayActionType =
  | 'update_contact_field'
  | 'update_contact_tags'
  | 'remove_contact_tags'
  | 'add_to_workflow'
  | 'remove_from_workflow'
  | 'opportunity_status'
  | 'opportunity_value'
  | 'dnd_channel'

export type PlayActionGroup = 'tagging' | 'workflows' | 'pipeline' | 'compliance' | 'fields'

export interface PlayActionDef {
  key: PlayActionType
  label: string
  description: string
  group: PlayActionGroup
  /**
   * Short example trigger for the empty-state. Picked at random when
   * the operator opens the Play wizard — gives them a concrete prompt
   * instead of a blank field.
   */
  exampleTrigger?: string
}

export const PLAY_ACTIONS: PlayActionDef[] = [
  // Tagging — lightweight, the most common
  {
    key: 'update_contact_tags',
    label: 'Add tags to contact',
    description: 'Apply one or more tags. Useful for routing, scoring, and downstream automations.',
    group: 'tagging',
    exampleTrigger: 'When the customer mentions a competitor by name',
  },
  {
    key: 'remove_contact_tags',
    label: 'Remove tags from contact',
    description: 'Strip specific tags off the contact.',
    group: 'tagging',
    exampleTrigger: 'When the customer says they\'re no longer interested',
  },

  // Workflows
  {
    key: 'add_to_workflow',
    label: 'Enrol contact in workflow',
    description: 'Add the contact to one or more LeadConnector workflows.',
    group: 'workflows',
    exampleTrigger: 'When the customer asks to be added to a waitlist',
  },
  {
    key: 'remove_from_workflow',
    label: 'Remove contact from workflow',
    description: 'Take the contact out of a workflow they\'re currently in.',
    group: 'workflows',
  },

  // Pipeline — the canonical example the user called out
  {
    key: 'opportunity_status',
    label: 'Change opportunity status',
    description: 'Mark the contact\'s opportunity as Won, Lost, Abandoned, or Open.',
    group: 'pipeline',
    exampleTrigger: 'When the customer commits to buying',
  },
  {
    key: 'opportunity_value',
    label: 'Set opportunity value',
    description: 'Update the monetary value of the opportunity.',
    group: 'pipeline',
    exampleTrigger: 'When the customer states a budget',
  },

  // Generic fields
  {
    key: 'update_contact_field',
    label: 'Update contact field',
    description: 'Write a value to a standard or custom field on the contact.',
    group: 'fields',
    exampleTrigger: 'When the customer shares their company name',
  },

  // Compliance
  {
    key: 'dnd_channel',
    label: 'Mark as Do Not Disturb',
    description: 'Block messaging on a channel for this contact.',
    group: 'compliance',
    exampleTrigger: 'When the customer asks to stop being contacted',
  },
]

export const PLAY_ACTION_GROUP_LABEL: Record<PlayActionGroup, string> = {
  tagging: 'Tagging',
  workflows: 'Workflows',
  pipeline: 'Pipeline',
  fields: 'Custom fields',
  compliance: 'Compliance',
}

export const PLAY_ACTION_GROUP_ORDER: PlayActionGroup[] = [
  'pipeline', 'tagging', 'workflows', 'fields', 'compliance',
]

// ─── Lookups ──────────────────────────────────────────────────────────────────

export function getReflex(key: string): ReflexDef | undefined {
  return REFLEXES.find(r => r.key === key)
}

export function getPlayAction(key: string): PlayActionDef | undefined {
  return PLAY_ACTIONS.find(a => a.key === key)
}

/**
 * The set of tool keys an operator should NOT see as Reflex toggles —
 * these are all available exclusively as Plays, fired deterministically.
 * Used by the legacy /tools page to filter out write-operations that
 * have moved to Playbook.
 */
export const PLAY_ONLY_TOOL_KEYS = new Set<string>([
  'update_contact_field',
  'update_contact_tags',
  'remove_contact_tags',
  'add_to_workflow',
  'remove_from_workflow',
  'move_opportunity_stage',
])
