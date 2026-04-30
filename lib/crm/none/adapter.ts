/**
 * NoCrmAdapter — returned by the factory when the workspace hasn't
 * connected a CRM yet (placeholder Location with crmProvider='none').
 *
 * Every method throws a clear "CRM not connected" error. This is
 * deliberate: silent no-ops would hide real misconfigurations where an
 * agent is deployed on SMS/Email but has no CRM to send through. The
 * error propagates up so the operator sees why the message didn't send.
 *
 * Widget-only agents don't hit this adapter at all — the widget path uses
 * WidgetAdapter, which doesn't depend on a CRM connection.
 */

import type {
  CrmAdapter, BookAppointmentPayload, CreateOpportunityPayload, CustomField, CrmProvider,
} from '../types'
import type { Contact, Conversation, CrmUser, Message, Opportunity, SendMessagePayload } from '@/types'

function missing(): never {
  throw new Error(
    'CRM not connected. Connect GoHighLevel from Integrations, or build a widget-only agent.',
  )
}

export class NoCrmAdapter implements CrmAdapter {
  provider: CrmProvider = 'none'
  locationId: string

  constructor(locationId: string) {
    this.locationId = locationId
  }

  getContact(_contactId: string): Promise<Contact> { missing() }
  searchContacts(_query: string): Promise<Contact[]> { missing() }
  createContact(_payload: Partial<Contact>): Promise<Contact> { missing() }
  updateContact(_contactId: string, _payload: Partial<Contact>): Promise<Contact> { missing() }
  addTags(_contactId: string, _tags: string[]): Promise<void> { missing() }
  updateContactField(_contactId: string, _fieldKey: string, _value: string): Promise<void> { missing() }
  getCustomFields(): Promise<CustomField[]> { missing() }

  searchConversations(_opts?: { contactId?: string; limit?: number }): Promise<Conversation[]> { missing() }
  getConversation(_conversationId: string): Promise<Conversation> { missing() }
  getMessages(_conversationId: string, _limit?: number): Promise<Message[]> { missing() }
  sendMessage(_payload: SendMessagePayload): Promise<{ messageId: string; conversationId: string }> { missing() }

  getOpportunitiesForContact(_contactId: string): Promise<Opportunity[]> { missing() }
  updateOpportunityStage(_opportunityId: string, _stageId: string): Promise<Opportunity> { missing() }
  createOpportunity(_payload: CreateOpportunityPayload): Promise<any> { missing() }
  updateOpportunityValue(_opportunityId: string, _monetaryValue: number): Promise<any> { missing() }

  getFreeSlots(_calendarId: string, _startDate: string, _endDate: string, _timezone?: string) { return missing() as Promise<Array<{ startTime: string; endTime: string }>> }
  async getCalendarTimezone(_calendarId: string): Promise<string | null> { return null }
  bookAppointment(_payload: BookAppointmentPayload): Promise<any> { missing() }
  getAppointment(_eventId: string): Promise<any> { missing() }
  updateAppointment(_eventId: string, _payload: any): Promise<any> { missing() }
  getCalendarEvents(_contactId: string): Promise<any> { missing() }
  createAppointmentNote(_appointmentId: string, _body: string): Promise<any> { missing() }
  updateAppointmentNote(_appointmentId: string, _noteId: string, _body: string): Promise<any> { missing() }

  // User merge fields are a nicety, not a hard requirement — returning null
  // rather than throwing keeps widget-only / placeholder workspaces working.
  async getUser(_userId: string): Promise<CrmUser | null> { return null }
}
