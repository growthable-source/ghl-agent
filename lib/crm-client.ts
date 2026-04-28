/**
 * CRM API Client — Backward-compatible wrapper
 * Delegates to the GHL adapter. Consumers should migrate to using
 * getCrmAdapter() from lib/crm/factory.ts directly.
 */

import { GhlAdapter } from './crm/ghl/adapter'
import type { Contact, Conversation, Message, Opportunity, SendMessagePayload } from '@/types'

export type { CustomField } from './crm/types'

// Re-export the adapter and factory for new consumers
export { GhlAdapter } from './crm/ghl/adapter'
export { getCrmAdapter, createCrmAdapter } from './crm/factory'
export type { CrmAdapter } from './crm/types'

// ─── Backward-compatible function exports ─────────────────────────────────
// These create a new adapter per call. Prefer getCrmAdapter() for efficiency.

/**
 * Placeholder Locations exist purely as FK targets for agents created
 * before a real CRM is connected (crmProvider='none', empty OAuth tokens).
 * Hitting GHL with these triggers `No valid token` errors and 422s on
 * token refresh. Reads no-op safely; writes throw a clear message so the
 * caller knows the workspace isn't connected yet.
 */
function isPlaceholder(locationId: string): boolean {
  return locationId.startsWith('placeholder:')
}

function noCrmConnected(method: string): never {
  throw new Error(`Cannot ${method} — this workspace has no CRM connected yet.`)
}

export async function getContact(locationId: string, contactId: string): Promise<Contact> {
  if (isPlaceholder(locationId)) noCrmConnected('look up the contact')
  return new GhlAdapter(locationId).getContact(contactId)
}

export async function searchContacts(locationId: string, query: string): Promise<Contact[]> {
  if (isPlaceholder(locationId)) return []
  return new GhlAdapter(locationId).searchContacts(query)
}

export async function createContact(locationId: string, payload: Partial<Contact>): Promise<Contact> {
  if (isPlaceholder(locationId)) noCrmConnected('create a contact')
  return new GhlAdapter(locationId).createContact(payload)
}

export async function updateContact(locationId: string, contactId: string, payload: Partial<Contact>): Promise<Contact> {
  if (isPlaceholder(locationId)) noCrmConnected('update the contact')
  return new GhlAdapter(locationId).updateContact(contactId, payload)
}

export async function addTagsToContact(locationId: string, contactId: string, tags: string[]): Promise<void> {
  if (isPlaceholder(locationId)) return
  return new GhlAdapter(locationId).addTags(contactId, tags)
}

export async function updateContactField(locationId: string, contactId: string, fieldKey: string, value: string): Promise<void> {
  if (isPlaceholder(locationId)) return
  return new GhlAdapter(locationId).updateContactField(contactId, fieldKey, value)
}

export async function getCustomFields(locationId: string) {
  if (isPlaceholder(locationId)) return []
  return new GhlAdapter(locationId).getCustomFields()
}

export async function searchConversations(locationId: string, opts?: { contactId?: string; limit?: number }): Promise<Conversation[]> {
  if (isPlaceholder(locationId)) return []
  return new GhlAdapter(locationId).searchConversations(opts)
}

export async function getConversation(locationId: string, conversationId: string): Promise<Conversation> {
  if (isPlaceholder(locationId)) noCrmConnected('load the conversation')
  return new GhlAdapter(locationId).getConversation(conversationId)
}

export async function getMessages(locationId: string, conversationId: string, limit?: number): Promise<Message[]> {
  if (isPlaceholder(locationId)) return []
  return new GhlAdapter(locationId).getMessages(conversationId, limit)
}

export async function sendMessage(locationId: string, payload: SendMessagePayload): Promise<{ messageId: string; conversationId: string }> {
  if (isPlaceholder(locationId)) noCrmConnected('send a CRM message')
  return new GhlAdapter(locationId).sendMessage(payload)
}

export async function getOpportunitiesForContact(locationId: string, contactId: string): Promise<Opportunity[]> {
  if (isPlaceholder(locationId)) return []
  return new GhlAdapter(locationId).getOpportunitiesForContact(contactId)
}

export async function updateOpportunityStage(locationId: string, opportunityId: string, stageId: string): Promise<Opportunity> {
  return new GhlAdapter(locationId).updateOpportunityStage(opportunityId, stageId)
}

export async function updateOpportunityStatus(locationId: string, opportunityId: string, status: 'open' | 'won' | 'lost' | 'abandoned'): Promise<void> {
  return new GhlAdapter(locationId).updateOpportunityStatus(opportunityId, status)
}

export async function updateOpportunityValue(locationId: string, opportunityId: string, monetaryValue: number): Promise<any> {
  return new GhlAdapter(locationId).updateOpportunityValue(opportunityId, monetaryValue)
}

export async function addContactToWorkflow(locationId: string, contactId: string, workflowId: string, eventStartTime?: string): Promise<void> {
  return (new GhlAdapter(locationId) as any).addContactToWorkflow(contactId, workflowId, eventStartTime)
}

export async function removeContactFromWorkflow(locationId: string, contactId: string, workflowId: string): Promise<void> {
  return (new GhlAdapter(locationId) as any).removeContactFromWorkflow(contactId, workflowId)
}

export async function markContactDnd(locationId: string, contactId: string, channel?: string): Promise<void> {
  return (new GhlAdapter(locationId) as any).markContactDnd(contactId, channel)
}

export async function getFreeSlots(locationId: string, calendarId: string, startDate: string, endDate: string, timezone?: string) {
  return new GhlAdapter(locationId).getFreeSlots(calendarId, startDate, endDate, timezone)
}

export async function bookAppointment(locationId: string, payload: { calendarId: string; contactId: string; startTime: string; endTime: string; title?: string; notes?: string; selectedTimezone?: string }) {
  return new GhlAdapter(locationId).bookAppointment(payload)
}

export async function getAppointment(locationId: string, eventId: string) {
  return new GhlAdapter(locationId).getAppointment(eventId)
}

export async function updateAppointment(locationId: string, eventId: string, payload: any) {
  return new GhlAdapter(locationId).updateAppointment(eventId, payload)
}

export async function createAppointmentNote(locationId: string, appointmentId: string, body: string) {
  return new GhlAdapter(locationId).createAppointmentNote(appointmentId, body)
}

export async function updateAppointmentNote(locationId: string, appointmentId: string, noteId: string, body: string) {
  return new GhlAdapter(locationId).updateAppointmentNote(appointmentId, noteId, body)
}
