/**
 * GoHighLevel CRM Adapter
 * Implements CrmAdapter for the GHL REST API.
 * Extracted from lib/crm-client.ts — same logic, class-based.
 */

import { getValidAccessToken } from '@/lib/token-store'
import type { Contact, Conversation, Message, Opportunity, SendMessagePayload } from '@/types'
import type { CrmAdapter, CustomField, BookAppointmentPayload, CreateOpportunityPayload } from '../types'

const BASE_URL = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'

export class GhlAdapter implements CrmAdapter {
  provider = 'ghl' as const
  locationId: string

  constructor(locationId: string) {
    this.locationId = locationId
  }

  // ─── Core fetch wrapper ──────────────────────────────────────────────

  private async apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await getValidAccessToken(this.locationId)
    if (!token) throw new Error(`No valid token for location: ${this.locationId}`)

    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Version': API_VERSION,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers ?? {}),
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GHL API error ${res.status} on ${path}: ${body.slice(0, 500)}`)
    }

    return res.json() as Promise<T>
  }

  // ─── Contacts ────────────────────────────────────────────────────────

  async getContact(contactId: string): Promise<Contact> {
    const data = await this.apiFetch<{ contact: Contact }>(`/contacts/${contactId}`)
    return data.contact
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const params = new URLSearchParams({ locationId: this.locationId, query, limit: '20' })
    const data = await this.apiFetch<{ contacts: Contact[] }>(`/contacts/?${params}`)
    return data.contacts ?? []
  }

  async createContact(payload: Partial<Contact>): Promise<Contact> {
    const data = await this.apiFetch<{ contact: Contact }>('/contacts/', {
      method: 'POST',
      body: JSON.stringify({ ...payload, locationId: this.locationId }),
    })
    return data.contact
  }

  async updateContact(contactId: string, payload: Partial<Contact>): Promise<Contact> {
    const data = await this.apiFetch<{ contact: Contact }>(`/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
    return data.contact
  }

  async addTags(contactId: string, tags: string[]): Promise<void> {
    await this.apiFetch(`/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags }),
    })
  }

  async updateContactField(contactId: string, fieldKey: string, value: string): Promise<void> {
    if (fieldKey.startsWith('contact.') || fieldKey.startsWith('custom.')) {
      await this.apiFetch(`/contacts/${contactId}`, {
        method: 'PUT',
        body: JSON.stringify({
          customFields: [{ key: fieldKey, field_value: value }],
        }),
      })
    } else {
      await this.updateContact(contactId, { [fieldKey]: value } as any)
    }
  }

  async getCustomFields(): Promise<CustomField[]> {
    try {
      const data = await this.apiFetch<{ customFields: CustomField[] }>(
        `/locations/${this.locationId}/customFields`
      )
      return data.customFields ?? []
    } catch (err) {
      console.error('[GHL] getCustomFields failed:', err)
      return []
    }
  }

  // ─── Conversations & Messaging ───────────────────────────────────────

  async searchConversations(opts: { contactId?: string; limit?: number } = {}): Promise<Conversation[]> {
    const params = new URLSearchParams({
      locationId: this.locationId,
      limit: String(opts.limit ?? 20),
      ...(opts.contactId ? { contactId: opts.contactId } : {}),
    })
    const data = await this.apiFetch<{ conversations: Conversation[] }>(
      `/conversations/search?${params}`
    )
    return data.conversations ?? []
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    const data = await this.apiFetch<{ conversation: Conversation }>(
      `/conversations/${conversationId}`
    )
    return data.conversation
  }

  async getMessages(conversationId: string, limit = 20): Promise<Message[]> {
    const params = new URLSearchParams({ limit: String(limit) })
    const data = await this.apiFetch<{ messages: { messages: Message[] } }>(
      `/conversations/${conversationId}/messages?${params}`
    )
    return data.messages?.messages ?? []
  }

  async sendMessage(payload: SendMessagePayload): Promise<{ messageId: string; conversationId: string }> {
    console.log(`[GHL] sendMessage type=${payload.type} contact=${payload.contactId} provId=${payload.conversationProviderId ?? 'none'}`)
    return this.apiFetch('/conversations/messages', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  // ─── Opportunities / Deals ───────────────────────────────────────────

  async getOpportunitiesForContact(contactId: string): Promise<Opportunity[]> {
    const params = new URLSearchParams({ contact_id: contactId, location_id: this.locationId })
    const data = await this.apiFetch<{ opportunities: Opportunity[] }>(
      `/opportunities/search?${params}`
    )
    return data.opportunities ?? []
  }

  async updateOpportunityStage(opportunityId: string, pipelineStageId: string): Promise<Opportunity> {
    const data = await this.apiFetch<{ opportunity: Opportunity }>(
      `/opportunities/${opportunityId}`,
      {
        method: 'PUT',
        body: JSON.stringify({ pipelineStageId }),
      }
    )
    return data.opportunity
  }

  async createOpportunity(payload: CreateOpportunityPayload): Promise<any> {
    return this.apiFetch('/opportunities/', {
      method: 'POST',
      body: JSON.stringify({
        title: payload.name,
        contactId: payload.contactId,
        pipelineId: payload.pipelineId,
        pipelineStageId: payload.pipelineStageId,
        monetaryValue: payload.monetaryValue,
        locationId: this.locationId,
      }),
    })
  }

  async updateOpportunityValue(opportunityId: string, monetaryValue: number): Promise<any> {
    return this.apiFetch(`/opportunities/${opportunityId}`, {
      method: 'PUT',
      body: JSON.stringify({ monetaryValue }),
    })
  }

  // ─── Calendar ────────────────────────────────────────────────────────

  async getFreeSlots(
    calendarId: string,
    startDate: string,
    endDate: string,
    timezone?: string
  ): Promise<Array<{ startTime: string; endTime: string }>> {
    const params = new URLSearchParams({ startDate, endDate })
    if (timezone) params.set('timezone', timezone)

    const data = await this.apiFetch<Record<string, any>>(
      `/calendars/${calendarId}/free-slots?${params}`
    )

    const slots: Array<{ startTime: string; endTime: string }> = []
    for (const [date, value] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      const slotArray = Array.isArray(value) ? value
        : value?.slots && Array.isArray(value.slots) ? value.slots
        : []
      for (const slot of slotArray) {
        if (typeof slot === 'string') {
          slots.push({ startTime: `${date}T${slot}`, endTime: '' })
        } else if (slot && typeof slot === 'object' && slot.startTime) {
          slots.push({ startTime: slot.startTime, endTime: slot.endTime || '' })
        }
      }
    }
    return slots
  }

  async bookAppointment(payload: BookAppointmentPayload): Promise<any> {
    return this.apiFetch('/calendars/events/appointments', {
      method: 'POST',
      body: JSON.stringify({
        calendarId: payload.calendarId,
        locationId: this.locationId,
        contactId: payload.contactId,
        startTime: payload.startTime,
        endTime: payload.endTime,
        title: payload.title || 'Appointment',
        appointmentStatus: 'confirmed',
        ...(payload.selectedTimezone ? { selectedTimezone: payload.selectedTimezone } : {}),
        ...(payload.notes ? { notes: payload.notes } : {}),
      }),
    })
  }

  async getAppointment(eventId: string): Promise<any> {
    return this.apiFetch(`/calendars/events/appointments/${eventId}`)
  }

  async updateAppointment(eventId: string, payload: any): Promise<any> {
    return this.apiFetch(`/calendars/events/appointments/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    })
  }

  async getCalendarEvents(contactId: string): Promise<any> {
    return this.apiFetch(
      `/calendars/events?contactId=${contactId}&locationId=${this.locationId}`,
      { headers: { 'Version': '2021-04-15' } }
    )
  }

  async createAppointmentNote(appointmentId: string, body: string): Promise<any> {
    return this.apiFetch(`/calendars/appointments/${appointmentId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
  }

  async updateAppointmentNote(appointmentId: string, noteId: string, body: string): Promise<any> {
    return this.apiFetch(`/calendars/appointments/${appointmentId}/notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    })
  }
}
