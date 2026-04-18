export interface ToolDefinition {
  name: string
  label: string
  description: string
  category: 'messaging' | 'contacts' | 'pipeline' | 'calendar' | 'intelligence' | 'automation'
  requiresConfig?: boolean
}

export const ALL_TOOLS: ToolDefinition[] = [
  // Messaging
  { name: 'send_reply', label: 'Send Reply', description: 'Reply on the current channel (SMS, WhatsApp, Facebook, Instagram, Live Chat)', category: 'messaging' },
  { name: 'send_sms', label: 'Send SMS', description: 'Send an SMS directly (use Send Reply for auto channel detection)', category: 'messaging' },
  { name: 'send_email', label: 'Send Email', description: 'Send an email to the contact', category: 'messaging' },

  // Contacts
  { name: 'get_contact_details', label: 'Get Contact Details', description: 'Look up contact info, tags, and source', category: 'contacts' },
  { name: 'update_contact_tags', label: 'Update Tags', description: 'Add tags to the contact', category: 'contacts' },
  { name: 'add_contact_note', label: 'Add Note', description: 'Add a note to the contact record', category: 'contacts' },
  { name: 'search_contacts', label: 'Search Contacts', description: 'Find contacts by name, email, or phone', category: 'contacts' },
  { name: 'create_contact', label: 'Create Contact', description: 'Create a new contact in the CRM', category: 'contacts' },

  // Pipeline
  { name: 'get_opportunities', label: 'Get Opportunities', description: 'Fetch pipeline opportunities for the contact', category: 'pipeline' },
  { name: 'move_opportunity_stage', label: 'Move Pipeline Stage', description: 'Move an opportunity to a different stage', category: 'pipeline' },
  { name: 'create_opportunity', label: 'Create Opportunity', description: 'Create a new pipeline opportunity', category: 'pipeline' },
  { name: 'update_opportunity_value', label: 'Update Deal Value', description: 'Set monetary value on an opportunity', category: 'pipeline' },

  // Calendar
  { name: 'get_available_slots', label: 'Get Available Slots', description: 'Check calendar availability for booking', category: 'calendar' },
  { name: 'book_appointment', label: 'Book Appointment', description: 'Book an appointment on a calendar', category: 'calendar' },
  { name: 'cancel_appointment', label: 'Cancel Appointment', description: 'Cancel an existing appointment', category: 'calendar' },
  { name: 'reschedule_appointment', label: 'Reschedule Appointment', description: 'Move an appointment to a new time', category: 'calendar' },
  { name: 'get_calendar_events', label: 'Get Calendar Events', description: 'List upcoming appointments for a contact', category: 'calendar' },
  { name: 'create_appointment_note', label: 'Add Appointment Note', description: 'Attach a note with context to an appointment', category: 'calendar' },

  // Contacts (extended — from GHL Contacts spec)
  { name: 'find_contact_by_email_or_phone', label: 'Find by Email/Phone', description: 'Dedupe check — look up existing contact by exact email/phone', category: 'contacts' },
  { name: 'upsert_contact', label: 'Upsert Contact', description: 'Create-or-update a contact by email/phone (respects duplicate rules)', category: 'contacts' },
  { name: 'remove_contact_tags', label: 'Remove Tags', description: 'Remove one or more tags from a contact', category: 'contacts' },
  { name: 'create_task', label: 'Create Task', description: 'Create a follow-up task with a due date for a team member', category: 'contacts' },
  { name: 'add_to_workflow', label: 'Add to Workflow', description: 'Enroll the contact in a GHL automation workflow', category: 'automation' },
  { name: 'remove_from_workflow', label: 'Remove from Workflow', description: 'Stop a contact\'s progression through a workflow', category: 'automation' },
  { name: 'cancel_scheduled_message', label: 'Cancel Scheduled Message', description: 'Cancel an SMS/email that was scheduled to send later', category: 'messaging' },
  { name: 'list_contact_conversations', label: 'List Conversations', description: 'List contact conversation threads filtered by channel/status', category: 'messaging' },

  // Intelligence
  { name: 'score_lead', label: 'Score Lead', description: 'Score a lead 1-100 based on conversation signals and save to CRM', category: 'intelligence' },
  { name: 'detect_sentiment', label: 'Detect Sentiment', description: 'Analyse conversation sentiment and escalate if negative', category: 'intelligence' },

  // Automation
  { name: 'schedule_followup', label: 'Schedule Follow-up', description: 'Queue an automated follow-up SMS after a delay', category: 'automation' },
  { name: 'transfer_to_human', label: 'Transfer to Human', description: 'Escalate the conversation to a human agent with context', category: 'automation' },
]

export const DEFAULT_TOOLS = ALL_TOOLS
  .filter(t => !['calendar', 'intelligence', 'automation'].includes(t.category))
  .map(t => t.name)
