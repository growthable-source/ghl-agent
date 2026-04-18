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

  /**
   * List all tags for the connected location.
   * GET /locations/{locationId}/tags → { tags: [{ id, name, locationId }] }
   */
  async getTags(): Promise<Array<{ id: string; name: string }>> {
    try {
      const data = await this.apiFetch<{ tags: Array<{ id: string; name: string }> }>(
        `/locations/${this.locationId}/tags`
      )
      return data.tags ?? []
    } catch (err) {
      console.error('[GHL] getTags failed:', err)
      return []
    }
  }

  /**
   * Create a new tag in the location.
   * POST /locations/{locationId}/tags → { tag: { id, name, locationId } }
   */
  async createTag(name: string): Promise<{ id: string; name: string } | null> {
    try {
      const data = await this.apiFetch<{ tag: { id: string; name: string } }>(
        `/locations/${this.locationId}/tags`,
        { method: 'POST', body: JSON.stringify({ name }) },
      )
      return data.tag ?? null
    } catch (err) {
      console.error('[GHL] createTag failed:', err)
      return null
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
    // GHL spec (/calendars/{id}/free-slots) expects startDate/endDate as
    // numeric millisecond timestamps AND enforces a max 31-day range.
    const toMs = (s: string): number => {
      if (/^\d+$/.test(s)) return parseInt(s, 10)
      const d = new Date(s)
      if (isNaN(d.getTime())) throw new Error(`Invalid date: "${s}"`)
      return d.getTime()
    }
    let startMs = toMs(startDate)
    let endMs = toMs(endDate)
    if (endMs <= startMs) {
      // endDate same day or earlier — bump to end of the same day
      endMs = startMs + 24 * 60 * 60 * 1000 - 1
    }
    const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000
    if (endMs - startMs > MAX_RANGE_MS) {
      // Clamp to 31 days from start — GHL rejects longer ranges with 400.
      endMs = startMs + MAX_RANGE_MS
      console.warn(`[GHL] free-slots range clamped to 31 days (was ${Math.round((endMs - startMs) / 86400000)} days)`)
    }

    const params = new URLSearchParams({
      startDate: String(startMs),
      endDate: String(endMs),
    })
    if (timezone) params.set('timezone', timezone)

    const data = await this.apiFetch<Record<string, any>>(
      `/calendars/${calendarId}/free-slots?${params}`,
      { headers: { 'Version': '2021-04-15' } },
    )

    // Spec response shape:
    //   { "2024-10-28": { "slots": ["2024-10-28T10:00:00-05:00", ...] } }
    // Each slot is ALREADY a full ISO-with-offset string — don't concat
    // the date prefix again (the old code did and produced garbage like
    // "2024-10-28T2024-10-28T10:00:00-05:00").
    const slots: Array<{ startTime: string; endTime: string }> = []
    for (const [dateKey, value] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue
      const slotArray = Array.isArray(value) ? value
        : value?.slots && Array.isArray(value.slots) ? value.slots
        : []
      for (const slot of slotArray) {
        if (typeof slot === 'string') {
          // If the string already looks like a full ISO timestamp, keep it.
          // Otherwise (legacy "HH:MM:SS" format), prefix the date.
          const isFullIso = /^\d{4}-\d{2}-\d{2}T/.test(slot)
          slots.push({
            startTime: isFullIso ? slot : `${dateKey}T${slot}`,
            endTime: '',
          })
        } else if (slot && typeof slot === 'object' && slot.startTime) {
          slots.push({ startTime: slot.startTime, endTime: slot.endTime || '' })
        }
      }
    }
    return slots
  }

  /**
   * Fetch a calendar's eligible team members. Used to auto-fill assignedUserId
   * when the calendar requires one. Cached per adapter instance.
   */
  private calendarTeamCache: Map<string, string | null> = new Map()
  async pickCalendarTeamMember(calendarId: string): Promise<string | null> {
    if (this.calendarTeamCache.has(calendarId)) {
      return this.calendarTeamCache.get(calendarId) ?? null
    }
    try {
      const data = await this.apiFetch<any>(`/calendars/${calendarId}`, {
        headers: { 'Version': '2021-04-15' },
      })
      // GHL calendar response has `teamMembers: [{ userId, priority, ... }]`
      const members: any[] = data?.calendar?.teamMembers || data?.teamMembers || []
      // Prefer the highest-priority (lowest priority number) team member
      const sorted = members.slice().sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
      const pick = sorted[0]?.userId ?? null
      this.calendarTeamCache.set(calendarId, pick)
      return pick
    } catch (err: any) {
      console.warn(`[GHL] pickCalendarTeamMember failed for ${calendarId}:`, err.message)
      this.calendarTeamCache.set(calendarId, null)
      return null
    }
  }

  async bookAppointment(payload: BookAppointmentPayload): Promise<any> {
    // Auto-pick a team member if the caller didn't specify one — many GHL
    // calendars reject with 422 "A team member needs to be selected" otherwise.
    const assignedUserId = payload.assignedUserId
      ?? (await this.pickCalendarTeamMember(payload.calendarId))

    // Body matches the GHL AppointmentCreateSchema exactly.
    // Required: calendarId, locationId, contactId, startTime.
    const body: Record<string, unknown> = {
      calendarId: payload.calendarId,
      locationId: this.locationId,
      contactId: payload.contactId,
      startTime: payload.startTime,
      title: payload.title || 'Appointment',
      // GHL enum: "new" | "confirmed" | "cancelled" | "showed" | "noshow" | "invalid"
      // We default to "confirmed" because the lead has already picked a slot and
      // said yes — leaving it on "new" forces the operator to manually confirm
      // every booked appointment in GHL, which misses the point of automation.
      // Callers can override via payload.appointmentStatus if a specific calendar
      // rejects "confirmed".
      appointmentStatus: (payload as any).appointmentStatus || 'confirmed',
      // Spec: "If set to false, the automations will not run"
      toNotify: true,
      // Spec: "If true the time slot validation would be avoided for any
      // appointment creation". We already fetched free-slots — skip the race.
      ignoreFreeSlotValidation: true,
    }
    if (payload.endTime) body.endTime = payload.endTime
    // Spec uses `description` for freeform body text, not `notes`.
    // Our caller passes the conversation context as `notes` for clarity; map it.
    if (payload.notes) body.description = payload.notes
    if (assignedUserId) body.assignedUserId = assignedUserId

    try {
      const result = await this.apiFetch<any>('/calendars/events/appointments', {
        method: 'POST',
        headers: { 'Version': '2021-04-15' },
        body: JSON.stringify(body),
      })
      console.log(`[GHL] Appointment booked: ${result?.id ?? 'unknown'} for contact ${payload.contactId} at ${payload.startTime} (assigned=${assignedUserId ?? 'none'}, status=${body.appointmentStatus})`)
      return result
    } catch (err: any) {
      // If GHL rejected "confirmed" specifically (some calendars require manual
      // confirmation workflows and 422 with an appointmentStatus complaint),
      // retry once with "new" so the booking still lands.
      const isStatusReject =
        (payload as any).appointmentStatus === undefined &&
        body.appointmentStatus === 'confirmed' &&
        /appointmentStatus|appointment_status|status/i.test(err.message || '')
      if (isStatusReject) {
        console.warn(`[GHL] "confirmed" rejected for calendar ${payload.calendarId} — retrying with "new"`)
        body.appointmentStatus = 'new'
        try {
          const result = await this.apiFetch<any>('/calendars/events/appointments', {
            method: 'POST',
            headers: { 'Version': '2021-04-15' },
            body: JSON.stringify(body),
          })
          console.log(`[GHL] Appointment booked (fallback status=new): ${result?.id ?? 'unknown'}`)
          return result
        } catch (retryErr: any) {
          console.error('[GHL] bookAppointment FAILED after status retry', { error: retryErr.message })
          throw retryErr
        }
      }
      console.error('[GHL] bookAppointment FAILED', {
        calendarId: payload.calendarId,
        contactId: payload.contactId,
        startTime: payload.startTime,
        assignedUserId,
        appointmentStatus: body.appointmentStatus,
        error: err.message,
      })
      throw err
    }
  }

  async getAppointment(eventId: string): Promise<any> {
    return this.apiFetch(`/calendars/events/appointments/${eventId}`, {
      headers: { 'Version': '2021-04-15' },
    })
  }

  async updateAppointment(eventId: string, payload: any): Promise<any> {
    return this.apiFetch(`/calendars/events/appointments/${eventId}`, {
      method: 'PUT',
      headers: { 'Version': '2021-04-15' },
      body: JSON.stringify(payload),
    })
  }

  async getCalendarEvents(contactId: string): Promise<any> {
    // GHL spec requires startTime + endTime (millis). Default to the
    // next 90 days — good enough to show a contact's upcoming events.
    const now = Date.now()
    const ninetyDays = 90 * 24 * 60 * 60 * 1000
    const params = new URLSearchParams({
      locationId: this.locationId,
      // Per spec: either userId, calendarId, OR groupId is also required
      // alongside locationId. Most tenants use calendarId scoping via
      // contactId filter client-side, but since the spec doesn't accept
      // contactId as a filter, we pass it anyway and let GHL return
      // everything the token sees for the location, scoped by time.
      startTime: String(now - ninetyDays),
      endTime: String(now + ninetyDays),
    })
    return this.apiFetch(`/calendars/events?${params}`, {
      headers: { 'Version': '2021-04-15' },
    })
  }

  async createAppointmentNote(appointmentId: string, body: string): Promise<any> {
    return this.apiFetch(`/calendars/appointments/${appointmentId}/notes`, {
      method: 'POST',
      headers: { 'Version': '2021-04-15' },
      body: JSON.stringify({ body }),
    })
  }

  async updateAppointmentNote(appointmentId: string, noteId: string, body: string): Promise<any> {
    return this.apiFetch(`/calendars/appointments/${appointmentId}/notes/${noteId}`, {
      method: 'PUT',
      headers: { 'Version': '2021-04-15' },
      body: JSON.stringify({ body }),
    })
  }
}
