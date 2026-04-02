export interface ToolDefinition {
  name: string
  label: string
  description: string
  category: 'messaging' | 'contacts' | 'pipeline' | 'calendar'
  requiresConfig?: boolean
}

export const ALL_TOOLS: ToolDefinition[] = [
  { name: 'send_sms', label: 'Send SMS', description: 'Reply to the contact via SMS', category: 'messaging' },
  { name: 'get_contact_details', label: 'Get Contact Details', description: 'Look up contact info, tags, and source', category: 'contacts' },
  { name: 'update_contact_tags', label: 'Update Tags', description: 'Add tags to the contact', category: 'contacts' },
  { name: 'add_contact_note', label: 'Add Note', description: 'Add a note to the contact record', category: 'contacts' },
  { name: 'get_opportunities', label: 'Get Opportunities', description: 'Fetch pipeline opportunities for the contact', category: 'pipeline' },
  { name: 'move_opportunity_stage', label: 'Move Pipeline Stage', description: 'Move an opportunity to a different stage', category: 'pipeline' },
  { name: 'get_available_slots', label: 'Get Available Slots', description: 'Check calendar availability for booking', category: 'calendar' },
  { name: 'book_appointment', label: 'Book Appointment', description: 'Book an appointment on a calendar', category: 'calendar' },
  { name: 'search_contacts', label: 'Search Contacts', description: 'Find contacts by name, email, or phone', category: 'contacts' },
  { name: 'create_contact', label: 'Create Contact', description: 'Create a new contact in the CRM', category: 'contacts' },
  { name: 'send_email', label: 'Send Email', description: 'Send an email to the contact', category: 'messaging' },
  { name: 'create_opportunity', label: 'Create Opportunity', description: 'Create a new pipeline opportunity', category: 'pipeline' },
  { name: 'update_opportunity_value', label: 'Update Deal Value', description: 'Set monetary value on an opportunity', category: 'pipeline' },
  { name: 'get_calendar_events', label: 'Get Calendar Events', description: 'List upcoming appointments for a contact', category: 'calendar' },
]

export const DEFAULT_TOOLS = ALL_TOOLS
  .filter(t => t.category !== 'calendar')
  .map(t => t.name)
