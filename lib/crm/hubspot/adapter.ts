/**
 * HubSpot CRM Adapter
 * Implements CrmAdapter for the HubSpot v3 API.
 */

import { getHubSpotAccessToken } from './token-manager'
import type { Contact, Conversation, Message, Opportunity, SendMessagePayload } from '@/types'
import type { CrmAdapter, CustomField, BookAppointmentPayload, CreateOpportunityPayload } from '../types'

const BASE_URL = 'https://api.hubspot.com'

/** Standard contact properties to request on every read */
const CONTACT_PROPERTIES = [
  'firstname', 'lastname', 'email', 'phone',
  'hs_lead_status', 'lifecyclestage', 'hs_object_source',
  'createdate', 'lastmodifieddate', 'hs_tag',
].join(',')

export class HubSpotAdapter implements CrmAdapter {
  provider = 'hubspot' as const
  locationId: string

  constructor(locationId: string) {
    this.locationId = locationId
  }

  // ─── Core fetch wrapper ──────────────────────────────────────────────

  private async apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const token = await getHubSpotAccessToken(this.locationId)
    if (!token) throw new Error(`No valid HubSpot token for location: ${this.locationId}`)

    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers ?? {}),
      },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`HubSpot API error ${res.status} on ${path}: ${body.slice(0, 500)}`)
    }

    return res.json() as Promise<T>
  }

  // ─── Contacts ────────────────────────────────────────────────────────

  private mapContact(hs: any): Contact {
    const props = hs.properties ?? {}
    return {
      id: hs.id,
      locationId: this.locationId,
      firstName: props.firstname ?? undefined,
      lastName: props.lastname ?? undefined,
      name: [props.firstname, props.lastname].filter(Boolean).join(' ') || undefined,
      email: props.email ?? undefined,
      phone: props.phone ?? undefined,
      tags: props.hs_tag ? props.hs_tag.split(';').map((t: string) => t.trim()).filter(Boolean) : [],
      source: props.hs_object_source ?? undefined,
      customFields: Object.entries(props)
        .filter(([k]) => !CONTACT_PROPERTIES.split(',').includes(k))
        .map(([k, v]) => ({ id: k, value: String(v ?? '') })),
      dateAdded: hs.createdAt ?? props.createdate,
      dateUpdated: hs.updatedAt ?? props.lastmodifieddate,
    }
  }

  async getContact(contactId: string): Promise<Contact> {
    const data = await this.apiFetch<any>(
      `/crm/v3/objects/contacts/${contactId}?properties=${CONTACT_PROPERTIES}`
    )
    return this.mapContact(data)
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const data = await this.apiFetch<{ results: any[] }>(
      '/crm/v3/objects/contacts/search',
      {
        method: 'POST',
        body: JSON.stringify({
          query,
          limit: 20,
          properties: CONTACT_PROPERTIES.split(','),
        }),
      }
    )
    return (data.results ?? []).map((c: any) => this.mapContact(c))
  }

  async createContact(payload: Partial<Contact>): Promise<Contact> {
    const properties: Record<string, string> = {}
    if (payload.firstName) properties.firstname = payload.firstName
    if (payload.lastName) properties.lastname = payload.lastName
    if (payload.email) properties.email = payload.email
    if (payload.phone) properties.phone = payload.phone

    const data = await this.apiFetch<any>('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties }),
    })
    return this.mapContact(data)
  }

  async updateContact(contactId: string, payload: Partial<Contact>): Promise<Contact> {
    const properties: Record<string, string> = {}
    if (payload.firstName) properties.firstname = payload.firstName
    if (payload.lastName) properties.lastname = payload.lastName
    if (payload.email) properties.email = payload.email
    if (payload.phone) properties.phone = payload.phone

    const data = await this.apiFetch<any>(`/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    })
    return this.mapContact(data)
  }

  async addTags(contactId: string, tags: string[]): Promise<void> {
    // HubSpot has no native tags — uses hs_tag multi-select property (semicolon-separated)
    // Read-merge-write cycle to preserve existing tags
    const contact = await this.getContact(contactId)
    const existing = contact.tags ?? []
    const merged = [...new Set([...existing, ...tags])]

    await this.apiFetch(`/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: { hs_tag: merged.join(';') },
      }),
    })
  }

  async updateContactField(contactId: string, fieldKey: string, value: string): Promise<void> {
    await this.apiFetch(`/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: { [fieldKey]: value },
      }),
    })
  }

  async getCustomFields(): Promise<CustomField[]> {
    try {
      const data = await this.apiFetch<{ results: any[] }>(
        '/crm/v3/properties/contacts'
      )
      return (data.results ?? [])
        .filter((p: any) => !p.hubspotDefined) // only custom properties
        .map((p: any) => ({
          id: p.name,
          name: p.label,
          fieldKey: p.name,
          dataType: p.type,
          placeholder: p.description ?? undefined,
        }))
    } catch (err) {
      console.error('[HubSpot] getCustomFields failed:', err)
      return []
    }
  }

  // ─── Conversations & Messaging ───────────────────────────────────────
  // HubSpot Conversations API is limited. These methods provide best-effort
  // integration using the Conversations v3 threads API.

  async searchConversations(opts: { contactId?: string; limit?: number } = {}): Promise<Conversation[]> {
    // HubSpot doesn't support searching conversations by contact directly.
    // If a contactId is provided, we search for threads associated with that contact.
    if (opts.contactId) {
      try {
        const data = await this.apiFetch<{ results: any[] }>(
          `/crm/v3/objects/contacts/${opts.contactId}/associations/conversations`
        )
        const threads = data.results ?? []
        return threads.slice(0, opts.limit ?? 20).map((t: any) => ({
          id: t.id ?? t.toObjectId,
          locationId: this.locationId,
          contactId: opts.contactId!,
        }))
      } catch {
        // Conversations API may not be available — return empty
        return []
      }
    }

    // Without contactId, list recent threads
    try {
      const data = await this.apiFetch<{ results: any[] }>(
        `/conversations/v3/conversations/threads?limit=${opts.limit ?? 20}`
      )
      return (data.results ?? []).map((t: any) => ({
        id: t.id,
        locationId: this.locationId,
        contactId: t.associatedContactId ?? '',
      }))
    } catch {
      return []
    }
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    const data = await this.apiFetch<any>(
      `/conversations/v3/conversations/threads/${conversationId}`
    )
    return {
      id: data.id,
      locationId: this.locationId,
      contactId: data.associatedContactId ?? '',
      lastMessageDate: data.latestMessageTimestamp,
    }
  }

  async getMessages(conversationId: string, limit = 20): Promise<Message[]> {
    const data = await this.apiFetch<{ results: any[] }>(
      `/conversations/v3/conversations/threads/${conversationId}/messages?limit=${limit}`
    )
    return (data.results ?? []).map((m: any) => ({
      id: m.id,
      conversationId,
      locationId: this.locationId,
      contactId: m.senders?.[0]?.actorId ?? undefined,
      body: m.text ?? m.richText ?? '',
      direction: m.direction === 'INCOMING' ? 'inbound' as const : 'outbound' as const,
      status: m.status,
      dateAdded: m.createdAt,
    }))
  }

  async sendMessage(payload: SendMessagePayload): Promise<{ messageId: string; conversationId: string }> {
    // HubSpot Conversations: send a message to an existing thread.
    // If no conversationProviderId, we need to create an email engagement or note instead.
    // For channels like Email, we use the HubSpot single-send email or engagement API.

    if (payload.type === 'Email') {
      return this.sendEmailViaEngagement(payload)
    }

    // For non-email channels, try the Conversations API if we have a thread
    if (payload.conversationProviderId) {
      const data = await this.apiFetch<any>(
        `/conversations/v3/conversations/threads/${payload.conversationProviderId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'MESSAGE',
            text: payload.message,
            richText: `<p>${payload.message}</p>`,
            senderActorId: 'A-0', // default agent actor
          }),
        }
      )
      return {
        messageId: data.id ?? '',
        conversationId: payload.conversationProviderId,
      }
    }

    // Fallback: create a Note engagement on the contact record
    const data = await this.apiFetch<any>('/crm/v3/objects/notes', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          hs_note_body: payload.message,
          hs_timestamp: new Date().toISOString(),
        },
        associations: [{
          to: { id: payload.contactId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }], // note-to-contact
        }],
      }),
    })
    return {
      messageId: data.id ?? '',
      conversationId: '',
    }
  }

  private async sendEmailViaEngagement(payload: SendMessagePayload): Promise<{ messageId: string; conversationId: string }> {
    // Create an email engagement associated with the contact
    const data = await this.apiFetch<any>('/crm/v3/objects/emails', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          hs_email_direction: 'EMAIL',
          hs_email_status: 'SEND',
          hs_email_subject: payload.subject ?? 'Message from your agent',
          hs_email_text: payload.message,
          hs_email_html: payload.html ?? `<p>${payload.message}</p>`,
          hs_timestamp: new Date().toISOString(),
        },
        associations: [{
          to: { id: payload.contactId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 198 }], // email-to-contact
        }],
      }),
    })
    return {
      messageId: data.id ?? '',
      conversationId: '',
    }
  }

  // ─── Opportunities / Deals ───────────────────────────────────────────

  private mapDeal(hs: any): Opportunity {
    const props = hs.properties ?? {}
    return {
      id: hs.id,
      name: props.dealname ?? '',
      locationId: this.locationId,
      contactId: undefined, // resolved via associations
      pipelineId: props.pipeline ?? '',
      pipelineStageId: props.dealstage ?? '',
      status: props.dealstage ?? '',
      monetaryValue: props.amount ? parseFloat(props.amount) : undefined,
      assignedTo: props.hubspot_owner_id ?? undefined,
      createdAt: hs.createdAt ?? props.createdate,
      updatedAt: hs.updatedAt ?? props.hs_lastmodifieddate,
    }
  }

  async getOpportunitiesForContact(contactId: string): Promise<Opportunity[]> {
    // Search deals associated with this contact
    try {
      const assocData = await this.apiFetch<{ results: any[] }>(
        `/crm/v3/objects/contacts/${contactId}/associations/deals`
      )
      const dealIds = (assocData.results ?? []).map((a: any) => a.id ?? a.toObjectId)
      if (dealIds.length === 0) return []

      // Batch read the deals
      const data = await this.apiFetch<{ results: any[] }>(
        '/crm/v3/objects/deals/batch/read',
        {
          method: 'POST',
          body: JSON.stringify({
            inputs: dealIds.map((id: string) => ({ id })),
            properties: ['dealname', 'pipeline', 'dealstage', 'amount', 'hubspot_owner_id', 'createdate', 'hs_lastmodifieddate'],
          }),
        }
      )
      return (data.results ?? []).map((d: any) => ({
        ...this.mapDeal(d),
        contactId,
      }))
    } catch (err) {
      console.error('[HubSpot] getOpportunitiesForContact failed:', err)
      return []
    }
  }

  async updateOpportunityStage(opportunityId: string, pipelineStageId: string): Promise<Opportunity> {
    const data = await this.apiFetch<any>(`/crm/v3/objects/deals/${opportunityId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: { dealstage: pipelineStageId },
      }),
    })
    return this.mapDeal(data)
  }

  async createOpportunity(payload: CreateOpportunityPayload): Promise<any> {
    const data = await this.apiFetch<any>('/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          dealname: payload.name,
          pipeline: payload.pipelineId,
          dealstage: payload.pipelineStageId,
          amount: payload.monetaryValue?.toString() ?? '0',
        },
        associations: [{
          to: { id: payload.contactId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }], // deal-to-contact
        }],
      }),
    })
    return data
  }

  async updateOpportunityValue(opportunityId: string, monetaryValue: number): Promise<any> {
    return this.apiFetch(`/crm/v3/objects/deals/${opportunityId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: { amount: monetaryValue.toString() },
      }),
    })
  }

  // ─── Calendar / Meetings ─────────────────────────────────────────────
  // HubSpot has no free-slots/availability API. Meetings are logged as
  // engagement objects. For full scheduling, integrate Google Calendar/Outlook.

  async getFreeSlots(
    _calendarId: string,
    _startDate: string,
    _endDate: string,
    _timezone?: string
  ): Promise<Array<{ startTime: string; endTime: string }>> {
    // HubSpot does not provide an availability/free-slots API.
    // Return empty — the agent should gracefully handle this.
    console.warn('[HubSpot] getFreeSlots not supported — HubSpot has no availability API')
    return []
  }

  async bookAppointment(payload: BookAppointmentPayload): Promise<any> {
    // Create a Meeting engagement object associated with the contact
    const data = await this.apiFetch<any>('/crm/v3/objects/meetings', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          hs_meeting_title: payload.title ?? 'Appointment',
          hs_meeting_start_time: payload.startTime,
          hs_meeting_end_time: payload.endTime,
          hs_meeting_body: payload.notes ?? '',
          hs_timestamp: payload.startTime,
          hs_meeting_outcome: 'SCHEDULED',
        },
        associations: [{
          to: { id: payload.contactId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 200 }], // meeting-to-contact
        }],
      }),
    })
    return data
  }

  async getAppointment(eventId: string): Promise<any> {
    return this.apiFetch(`/crm/v3/objects/meetings/${eventId}?properties=hs_meeting_title,hs_meeting_start_time,hs_meeting_end_time,hs_meeting_body,hs_meeting_outcome`)
  }

  async updateAppointment(eventId: string, payload: any): Promise<any> {
    const properties: Record<string, string> = {}
    if (payload.title) properties.hs_meeting_title = payload.title
    if (payload.startTime) properties.hs_meeting_start_time = payload.startTime
    if (payload.endTime) properties.hs_meeting_end_time = payload.endTime
    if (payload.notes) properties.hs_meeting_body = payload.notes
    if (payload.status) properties.hs_meeting_outcome = payload.status

    return this.apiFetch(`/crm/v3/objects/meetings/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties }),
    })
  }

  async getCalendarEvents(contactId: string): Promise<any> {
    // Get meetings associated with a contact
    try {
      const assocData = await this.apiFetch<{ results: any[] }>(
        `/crm/v3/objects/contacts/${contactId}/associations/meetings`
      )
      const meetingIds = (assocData.results ?? []).map((a: any) => a.id ?? a.toObjectId)
      if (meetingIds.length === 0) return { events: [] }

      const data = await this.apiFetch<{ results: any[] }>(
        '/crm/v3/objects/meetings/batch/read',
        {
          method: 'POST',
          body: JSON.stringify({
            inputs: meetingIds.map((id: string) => ({ id })),
            properties: ['hs_meeting_title', 'hs_meeting_start_time', 'hs_meeting_end_time', 'hs_meeting_body', 'hs_meeting_outcome'],
          }),
        }
      )
      return { events: data.results ?? [] }
    } catch (err) {
      console.error('[HubSpot] getCalendarEvents failed:', err)
      return { events: [] }
    }
  }

  async createAppointmentNote(appointmentId: string, body: string): Promise<any> {
    // Create a Note object associated with the meeting
    const data = await this.apiFetch<any>('/crm/v3/objects/notes', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          hs_note_body: body,
          hs_timestamp: new Date().toISOString(),
        },
        associations: [{
          to: { id: appointmentId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }], // note-to-meeting
        }],
      }),
    })
    return data
  }

  async updateAppointmentNote(appointmentId: string, noteId: string, body: string): Promise<any> {
    // Update the note content
    return this.apiFetch(`/crm/v3/objects/notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        properties: { hs_note_body: body },
      }),
    })
  }
}
