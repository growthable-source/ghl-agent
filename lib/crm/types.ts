/**
 * CRM Adapter Interface
 * Provider-agnostic contract for all CRM operations.
 * Implementations: GhlAdapter, HubSpotAdapter (future)
 */

import type { Contact, Conversation, Message, Opportunity, SendMessagePayload } from '@/types'

export type CrmProvider = 'ghl' | 'hubspot'

export interface CustomField {
  id: string
  name: string
  fieldKey: string
  dataType: string
  placeholder?: string
  position?: number
}

export interface BookAppointmentPayload {
  calendarId: string
  contactId: string
  startTime: string
  endTime: string
  title?: string
  notes?: string
  selectedTimezone?: string
  /**
   * GHL user ID to assign the appointment to. Required by calendars that
   * have team members configured — GHL returns 422 if omitted. If not
   * provided, the adapter will auto-pick the first eligible team member
   * from the calendar's configuration.
   */
  assignedUserId?: string
}

export interface CreateOpportunityPayload {
  name: string
  contactId: string
  pipelineId: string
  pipelineStageId: string
  monetaryValue?: number
  status?: 'open' | 'won' | 'lost' | 'abandoned'
  assignedTo?: string
}

export interface CrmAdapter {
  provider: CrmProvider
  locationId: string

  // ─── Contacts ────────────────────────────────────────────────────────
  getContact(contactId: string): Promise<Contact>
  searchContacts(query: string): Promise<Contact[]>
  createContact(payload: Partial<Contact>): Promise<Contact>
  updateContact(contactId: string, payload: Partial<Contact>): Promise<Contact>
  addTags(contactId: string, tags: string[]): Promise<void>
  updateContactField(contactId: string, fieldKey: string, value: string): Promise<void>
  getCustomFields(): Promise<CustomField[]>

  // ─── Conversations & Messaging ───────────────────────────────────────
  searchConversations(opts?: { contactId?: string; limit?: number }): Promise<Conversation[]>
  getConversation(conversationId: string): Promise<Conversation>
  getMessages(conversationId: string, limit?: number): Promise<Message[]>
  sendMessage(payload: SendMessagePayload): Promise<{ messageId: string; conversationId: string }>

  // ─── Opportunities / Deals ───────────────────────────────────────────
  getOpportunitiesForContact(contactId: string): Promise<Opportunity[]>
  updateOpportunityStage(opportunityId: string, stageId: string): Promise<Opportunity>
  createOpportunity(payload: CreateOpportunityPayload): Promise<any>
  updateOpportunityValue(opportunityId: string, monetaryValue: number): Promise<any>

  // ─── Calendar ────────────────────────────────────────────────────────
  getFreeSlots(calendarId: string, startDate: string, endDate: string, timezone?: string): Promise<Array<{ startTime: string; endTime: string }>>
  bookAppointment(payload: BookAppointmentPayload): Promise<any>
  getAppointment(eventId: string): Promise<any>
  updateAppointment(eventId: string, payload: any): Promise<any>
  getCalendarEvents(contactId: string): Promise<any>
  createAppointmentNote(appointmentId: string, body: string): Promise<any>
  updateAppointmentNote(appointmentId: string, noteId: string, body: string): Promise<any>
}
