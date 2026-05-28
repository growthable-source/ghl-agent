/**
 * Hard-coded grouping of tools into UI sections on the agent /tools page.
 * Tools not in any category are rendered under 'Other' at the bottom.
 *
 * Order of categories drives display order. Order of tools within a
 * category drives display order.
 */

export interface ToolCategory {
  id: string
  label: string
  toolNames: string[]
}

export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    id: 'calendar', label: 'Calendar',
    toolNames: [
      'get_available_slots', 'book_appointment', 'cancel_appointment',
      'reschedule_appointment', 'get_calendar_events', 'create_appointment_note',
    ],
  },
  {
    id: 'conversations', label: 'Conversations',
    toolNames: [
      'send_reply', 'send_sms', 'send_email', 'transfer_to_human',
      'list_contact_conversations', 'cancel_scheduled_message',
    ],
  },
  {
    id: 'crm_reads', label: 'CRM Reads',
    toolNames: [
      'get_contact_details', 'find_contact_by_email_or_phone', 'search_contacts',
      'get_opportunities', 'list_pipelines',
    ],
  },
  {
    id: 'crm_writes', label: 'CRM Writes',
    toolNames: [
      'update_contact_tags', 'remove_contact_tags', 'update_contact_field',
      'upsert_contact', 'add_contact_note', 'update_contact_memory',
    ],
  },
  {
    id: 'workflows', label: 'Workflows',
    toolNames: ['add_to_workflow', 'remove_from_workflow'],
  },
  {
    id: 'tasks', label: 'Tasks',
    toolNames: ['create_task'],
  },
  {
    id: 'opportunities', label: 'Opportunities',
    toolNames: [
      'move_opportunity_stage', 'mark_opportunity_won',
      'mark_opportunity_lost', 'upsert_opportunity',
    ],
  },
  {
    id: 'commerce', label: 'Commerce',
    toolNames: [
      'search_shopify_products', 'check_shopify_inventory', 'lookup_shopify_customer',
      'check_shopify_order_status', 'create_shopify_checkout', 'create_shopify_discount',
      'record_back_in_stock_interest',
    ],
  },
]

export function categoryForTool(toolName: string): string {
  for (const cat of TOOL_CATEGORIES) {
    if (cat.toolNames.includes(toolName)) return cat.id
  }
  return 'other'
}
