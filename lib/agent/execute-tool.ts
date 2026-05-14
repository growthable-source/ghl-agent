/**
 * Tool execution dispatcher.
 *
 * Lifted out of lib/ai-agent.ts. The big switch that runs each tool the
 * agent invoked against the real CRM (or stubs in sandbox). Reads stay
 * live even in sandbox — see SAFE_READ_ONLY_TOOLS — so the playground
 * mirrors prod for calendar / contact / opportunity lookups.
 */

import { getCrmAdapter } from '../crm/factory'
import type { CrmAdapter } from '../crm/types'
import { SAFE_READ_ONLY_TOOLS } from './tool-catalog'
import { executeSandboxTool } from './sandbox'
import type { DeferredSendCapture, HandoverCapture } from './types'

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
    const { notify } = await import('../notifications')
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

export async function executeTool(
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
        const { addExistingTagsOnly } = await import('../tag-policy')
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
        const { writeMemoryCategory } = await import('../listening-rules')
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
          const { saveQualifyingAnswer, executeQualifyingAction } = await import('../qualifying')
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
        const { addExistingTagsOnly } = await import('../tag-policy')
        const tagResult = await addExistingTagsOnly(
          crm as any,
          input.contactId as string,
          [scoreTag],
        )
        if (agentId) {
          const { db: prisma } = await import('../db')
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
        const { addExistingTagsOnly } = await import('../tag-policy')
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
        const { db: prisma } = await import('../db')
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
      case 'end_conversation': {
        // Widget-only — close the WidgetConversation tied to the active
        // adapter. The adapter stashes the conversation id at
        // `crm.conversationId` (see lib/widget-adapter.ts). On any other
        // channel the adapter doesn't carry that field, so we surface a
        // friendly error rather than silently failing.
        const widgetConvId = (crm as any)?.conversationId as string | undefined
        if (!widgetConvId || !(crm as any)?.broadcastSystem) {
          return JSON.stringify({
            error: 'end_conversation only works in the live-chat widget — no-op on this channel.',
          })
        }
        const summary = String((input as any).summary || '').slice(0, 500)
        const { db: prisma } = await import('../db')
        await prisma.widgetConversation.update({
          where: { id: widgetConvId },
          data: { status: 'ended', lastMessageAt: new Date() },
        })
        // Setting WidgetConversation.status = 'ended' is sufficient
        // to gate the agent — runWidgetAgent's shouldAgentReply()
        // refuses to reply on any 'ended' convo. We deliberately do
        // NOT touch ConversationStateRecord here. An earlier version
        // of this tool did `updateMany({ where: { agentId, state:
        // 'ACTIVE' } })`, which paused EVERY active conversation for
        // that agent across every visitor — one end_conversation call
        // silenced the whole agent. Don't ever scope by agentId
        // alone; that table is per-(agentId, contactId).
        // Broadcast so the widget swaps the composer for the closure
        // banner + auto-opens the CSAT prompt. Same event the operator
        // PATCH endpoint emits — the widget doesn't care who closed it.
        try {
          const { broadcast } = await import('../widget-sse')
          await broadcast(widgetConvId, { type: 'status_changed', status: 'ended' })
        } catch (err: any) {
          console.warn('[end_conversation] broadcast failed:', err?.message)
        }
        return JSON.stringify({ success: true, summary, note: 'Conversation closed. Visitor will see closure banner and rating prompt.' })
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
        const { addExistingTagsOnly } = await import('../tag-policy')
        await addExistingTagsOnly(
          crm as any,
          input.contactId as string,
          ['human-requested', 'ai-paused'],
        )
        if (agentId) {
          const { db: prisma } = await import('../db')
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
        const { runSheetLookup } = await import('../data-sources')
        const result = await runSheetLookup({
          workspaceId,
          source: String((input as any).source || ''),
          query: (input as any).query as string | undefined,
        })
        return result
      }
      case 'query_airtable': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for data lookup' })
        const { runAirtableQuery } = await import('../data-sources')
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
        const { runRestGet } = await import('../data-sources')
        const result = await runRestGet({
          workspaceId,
          source: String((input as any).source || ''),
        })
        return result
      }

      // ─── Shopify (commerce) ────────────────────────────────────────
      // All four lazy-import the adapter factory so the import path is
      // only paid on tool invocation, not on every cold start. Each
      // returns a "shopify_not_connected" hint instead of throwing
      // when the workspace doesn't have a connected shop — that lets
      // the agent fall back to "I don't have access to live inventory"
      // gracefully instead of dying mid-conversation.
      case 'search_shopify_products': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for Shopify lookup' })
        const { getCommerceAdapter } = await import('../commerce/factory')
        const shop = await getCommerceAdapter(workspaceId)
        if (!shop) return JSON.stringify({ shopify_not_connected: true, hint: 'No Shopify store is connected for this workspace. Tell the customer you don\'t have live catalogue access and offer to take their question to the team.' })
        const query = String((input as any).query || '').trim()
        if (!query) return JSON.stringify({ error: 'query is required' })
        const limit = Number((input as any).limit) || 10
        const results = await shop.searchProducts(query, limit)
        return JSON.stringify({ query, count: results.length, products: results })
      }
      case 'check_shopify_inventory': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for Shopify lookup' })
        const { getCommerceAdapter } = await import('../commerce/factory')
        const shop = await getCommerceAdapter(workspaceId)
        if (!shop) return JSON.stringify({ shopify_not_connected: true })
        const variantId = String((input as any).variantId || '').trim()
        if (!variantId) return JSON.stringify({ error: 'variantId is required (full GID, e.g. gid://shopify/ProductVariant/123)' })
        const snapshot = await shop.getInventoryForVariant(variantId)
        if (!snapshot) return JSON.stringify({ found: false, variantId, hint: 'No variant with that ID. Re-run search_shopify_products and pass back a variants[].id verbatim.' })
        return JSON.stringify(snapshot)
      }
      case 'lookup_shopify_customer': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for Shopify lookup' })
        const { getCommerceAdapter } = await import('../commerce/factory')
        const shop = await getCommerceAdapter(workspaceId)
        if (!shop) return JSON.stringify({ shopify_not_connected: true })
        const email = ((input as any).email as string | undefined)?.trim() || null
        const phone = ((input as any).phone as string | undefined)?.trim() || null
        if (!email && !phone) return JSON.stringify({ error: 'Provide email or phone (or both).' })
        const customer = await shop.findCustomer({ email, phone })
        if (!customer) {
          return JSON.stringify({
            found: false,
            hint: 'No Shopify customer matched. Treat as a new customer — do not invent past purchases or order history.',
          })
        }
        return JSON.stringify(customer)
      }
      case 'check_shopify_order_status': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for Shopify lookup' })
        const { getCommerceAdapter } = await import('../commerce/factory')
        const shop = await getCommerceAdapter(workspaceId)
        if (!shop) return JSON.stringify({ shopify_not_connected: true })
        const orderName = String((input as any).orderName || '').trim()
        if (!orderName) return JSON.stringify({ error: 'orderName is required (e.g. "#1042" or "1042")' })
        const order = await shop.getOrderByName(orderName)
        if (!order) {
          return JSON.stringify({
            found: false,
            orderName,
            hint: 'No order with that number. Confirm the customer has the right number — Shopify order names are unique per store.',
          })
        }
        return JSON.stringify(order)
      }
      case 'create_shopify_checkout': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for Shopify lookup' })
        const { getCommerceAdapter } = await import('../commerce/factory')
        const shop = await getCommerceAdapter(workspaceId)
        if (!shop) return JSON.stringify({ shopify_not_connected: true })
        const lineItems = ((input as any).lineItems as Array<{ variantId: string; quantity: number }> | undefined) ?? []
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
          return JSON.stringify({ error: 'lineItems is required (array of {variantId, quantity})' })
        }
        if (lineItems.length > 10) {
          return JSON.stringify({ error: 'too many line items (max 10)' })
        }
        const customerEmail = ((input as any).customerEmail as string | undefined)?.trim() || null
        const discountCode = ((input as any).discountCode as string | undefined)?.trim() || null
        const note = ((input as any).note as string | undefined) ?? null
        try {
          const result = await shop.createDraftOrder({ lineItems, customerEmail, discountCode, note })
          return JSON.stringify({
            checkoutUrl: result.invoiceUrl,
            draftOrderId: result.id,
            total: result.totalPrice,
            currency: result.currencyCode,
            hint: 'Include the checkoutUrl in your reply so the customer can pay. Single-use link — once paid, the draft becomes a real order.',
          })
        } catch (err: any) {
          return JSON.stringify({ error: err?.message || 'draft order failed' })
        }
      }
      case 'record_back_in_stock_interest': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for Shopify lookup' })
        const variantId = String((input as any).variantId || '').trim()
        const productTitle = String((input as any).productTitle || '').trim()
        const variantTitle = ((input as any).variantTitle as string | undefined) ?? null
        if (!variantId || !productTitle) {
          return JSON.stringify({ error: 'variantId and productTitle are required' })
        }

        // First cut: only delivered on the widget channel. Meta/SMS
        // outbound has 24h-window / policy constraints we haven't
        // wired yet, and recording a signal we can't honour would be
        // dishonest. When the channel isn't supported we return a
        // hint so the agent can offer a different follow-up.
        const isWidget = adapter?.locationId?.startsWith('widget:') ?? false
        const conversationId = isWidget ? (adapter as unknown as { conversationId?: string })?.conversationId : null
        if (!isWidget || !conversationId) {
          return JSON.stringify({
            not_supported_on_channel: true,
            hint: 'Back-in-stock pings are currently only delivered via the chat widget. Offer to take the customer\'s email for a manual follow-up instead.',
          })
        }

        const { getShopifyConnection } = await import('../commerce/shopify/token-store')
        const conn = await getShopifyConnection(workspaceId)
        if (!conn) return JSON.stringify({ shopify_not_connected: true })

        const { db } = await import('../db')
        await db.shopifyInterestSignal.create({
          data: {
            shopId: conn.shop,
            variantId,
            channel: 'widget',
            conversationId,
            productTitle,
            variantTitle,
          },
        })
        return JSON.stringify({
          success: true,
          hint: 'Interest recorded. Tell the customer you\'ll DM them via this chat as soon as it\'s back in stock.',
        })
      }
      case 'create_shopify_discount': {
        if (!workspaceId) return JSON.stringify({ error: 'No workspace context for Shopify lookup' })
        const { getCommerceAdapter } = await import('../commerce/factory')
        const shop = await getCommerceAdapter(workspaceId)
        if (!shop) return JSON.stringify({ shopify_not_connected: true })
        const code = String((input as any).code || '').trim().toUpperCase()
        const type = (input as any).type as 'percentage' | 'fixed_amount'
        const value = Number((input as any).value)
        if (!code || !/^[A-Z0-9]{3,20}$/.test(code)) {
          return JSON.stringify({ error: 'code must be 3-20 alphanumeric chars (will be uppercased)' })
        }
        if (type !== 'percentage' && type !== 'fixed_amount') {
          return JSON.stringify({ error: 'type must be "percentage" or "fixed_amount"' })
        }
        if (!Number.isFinite(value) || value <= 0) {
          return JSON.stringify({ error: 'value must be a positive number' })
        }
        // Guardrail: hard-cap at 50% percentage / $200 fixed unless the
        // operator extends the limit later via agent settings. Stops a
        // jailbroken prompt from minting a 100%-off code.
        if (type === 'percentage' && value > 50) {
          return JSON.stringify({ error: 'percentage discount capped at 50%' })
        }
        if (type === 'fixed_amount' && value > 200) {
          return JSON.stringify({ error: 'fixed-amount discount capped at 200 in the shop currency' })
        }
        const usageLimit = Number((input as any).usageLimit) || 1
        const expiresInHours = Number((input as any).expiresInHours) || 72
        try {
          const result = await shop.createDiscountCode({ code, type, value, usageLimit, expiresInHours })
          return JSON.stringify({
            code: result.code,
            expiresAt: result.expiresAt,
            hint: 'Tell the customer the code in your reply, mention the expiry, and that it\'s single-use unless usageLimit was set higher.',
          })
        } catch (err: any) {
          return JSON.stringify({ error: err?.message || 'discount code creation failed' })
        }
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` })
    }
  } catch (err: any) {
    console.error(`[Agent] Tool ${toolName} failed:`, err.message)
    return JSON.stringify({ error: err.message })
  }
}
