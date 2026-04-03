/**
 * CRM API Client
 * Wraps all API calls. Uses neutral naming — no provider references.
 */

import { getValidAccessToken } from './token-store'
import type {
  Contact,
  Conversation,
  Message,
  Opportunity,
  SendMessagePayload,
} from '@/types'

const BASE_URL = 'https://services.leadconnectorhq.com'
const API_VERSION = '2021-07-28'

// ─── Core fetch wrapper ────────────────────────────────────────────────────

async function apiFetch<T>(
  locationId: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getValidAccessToken(locationId)
  if (!token) throw new Error(`No valid token for location: ${locationId}`)

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
    throw new Error(`API error ${res.status} on ${path}: ${body}`)
  }

  return res.json() as Promise<T>
}

// ─── Contacts ──────────────────────────────────────────────────────────────

export async function getContact(locationId: string, contactId: string): Promise<Contact> {
  const data = await apiFetch<{ contact: Contact }>(locationId, `/contacts/${contactId}`)
  return data.contact
}

export async function searchContacts(locationId: string, query: string): Promise<Contact[]> {
  const params = new URLSearchParams({ locationId, query, limit: '20' })
  const data = await apiFetch<{ contacts: Contact[] }>(locationId, `/contacts/?${params}`)
  return data.contacts ?? []
}

export async function createContact(
  locationId: string,
  payload: Partial<Contact>
): Promise<Contact> {
  const data = await apiFetch<{ contact: Contact }>(locationId, '/contacts/', {
    method: 'POST',
    body: JSON.stringify({ ...payload, locationId }),
  })
  return data.contact
}

export interface CustomField {
  id: string
  name: string
  fieldKey: string
  dataType: string
  placeholder?: string
  position?: number
}

export async function getCustomFields(locationId: string): Promise<CustomField[]> {
  try {
    const data = await apiFetch<{ customFields: CustomField[] }>(
      locationId,
      `/contacts/custom-fields?locationId=${locationId}`
    )
    return data.customFields ?? []
  } catch {
    return []
  }
}

export async function updateContactField(
  locationId: string,
  contactId: string,
  ghlFieldKey: string,
  value: string
): Promise<void> {
  // Custom fields have keys like "contact.field_name"
  if (ghlFieldKey.startsWith('contact.') || ghlFieldKey.startsWith('custom.')) {
    await apiFetch(locationId, `/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify({
        customFields: [{ key: ghlFieldKey, field_value: value }],
      }),
    })
  } else {
    // Standard field (firstName, lastName, email, phone, etc.)
    await updateContact(locationId, contactId, { [ghlFieldKey]: value } as any)
  }
}

export async function updateContact(
  locationId: string,
  contactId: string,
  payload: Partial<Contact>
): Promise<Contact> {
  const data = await apiFetch<{ contact: Contact }>(locationId, `/contacts/${contactId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  return data.contact
}

export async function addTagsToContact(
  locationId: string,
  contactId: string,
  tags: string[]
): Promise<void> {
  await apiFetch(locationId, `/contacts/${contactId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tags }),
  })
}

// ─── Conversations ─────────────────────────────────────────────────────────

export async function searchConversations(
  locationId: string,
  opts: { contactId?: string; limit?: number } = {}
): Promise<Conversation[]> {
  const params = new URLSearchParams({
    locationId,
    limit: String(opts.limit ?? 20),
    ...(opts.contactId ? { contactId: opts.contactId } : {}),
  })
  const data = await apiFetch<{ conversations: Conversation[] }>(
    locationId,
    `/conversations/search?${params}`
  )
  return data.conversations ?? []
}

export async function getConversation(
  locationId: string,
  conversationId: string
): Promise<Conversation> {
  const data = await apiFetch<{ conversation: Conversation }>(
    locationId,
    `/conversations/${conversationId}`
  )
  return data.conversation
}

export async function getMessages(
  locationId: string,
  conversationId: string,
  limit = 20
): Promise<Message[]> {
  // Messages are nested under the conversation endpoint
  const params = new URLSearchParams({ limit: String(limit) })
  const data = await apiFetch<{ messages: { messages: Message[] } }>(
    locationId,
    `/conversations/${conversationId}/messages?${params}`
  )
  return data.messages?.messages ?? []
}

// ─── Send Message ──────────────────────────────────────────────────────────

export async function sendMessage(
  locationId: string,
  payload: SendMessagePayload
): Promise<{ messageId: string; conversationId: string }> {
  return apiFetch(locationId, '/conversations/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

// ─── Opportunities ─────────────────────────────────────────────────────────

export async function getOpportunitiesForContact(
  locationId: string,
  contactId: string
): Promise<Opportunity[]> {
  const params = new URLSearchParams({ contact_id: contactId, location_id: locationId })
  const data = await apiFetch<{ opportunities: Opportunity[] }>(
    locationId,
    `/opportunities/search?${params}`
  )
  return data.opportunities ?? []
}

export async function updateOpportunityStage(
  locationId: string,
  opportunityId: string,
  pipelineStageId: string
): Promise<Opportunity> {
  const data = await apiFetch<{ opportunity: Opportunity }>(
    locationId,
    `/opportunities/${opportunityId}`,
    {
      method: 'PUT',
      body: JSON.stringify({ pipelineStageId }),
    }
  )
  return data.opportunity
}

// ─── Calendars ─────────────────────────────────────────────────────────────

export async function getFreeSlots(
  locationId: string,
  calendarId: string,
  startDate: string,  // ISO
  endDate: string     // ISO
): Promise<Array<{ startTime: string; endTime: string }>> {
  const params = new URLSearchParams({ startDate, endDate })
  const data = await apiFetch<{ _dates_: Record<string, string[]> }>(
    locationId,
    `/calendars/${calendarId}/free-slots?${params}`
  )
  // Flatten the dates map into flat slot objects
  return Object.entries(data._dates_ ?? {}).flatMap(([date, times]) =>
    times.map(t => ({ startTime: `${date}T${t}`, endTime: '' }))
  )
}

export async function bookAppointment(
  locationId: string,
  payload: {
    calendarId: string
    contactId: string
    startTime: string
    endTime: string
    title?: string
    notes?: string
  }
): Promise<{ id: string; startTime: string }> {
  return apiFetch(locationId, '/calendars/events/appointments', {
    method: 'POST',
    body: JSON.stringify({ ...payload, locationId }),
  })
}
