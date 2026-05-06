/**
 * Sandbox tool executor — pure stub responses for the playground.
 *
 * Lifted out of lib/ai-agent.ts. Read-only tools fall through to the real
 * CRM (see SAFE_READ_ONLY_TOOLS in tool-catalog) so the playground sees
 * actual contact / calendar / opportunity data; writes are stubbed here.
 */

export function executeSandboxTool(toolName: string, input: Record<string, unknown>): string {
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
