/**
 * NativeAdapter — built-in CRM backend for workspaces that don't connect
 * an external CRM (GHL/HubSpot). Persists contacts, conversations, and
 * messages directly in our DB.
 *
 * Outbound message *delivery* (Twilio for SMS, an SMTP/transactional rail
 * for email, etc.) is intentionally not wired here yet: sendMessage
 * persists the row with status='queued' and returns. The follow-up to
 * this PR adds a workspace-level channel config + a worker that drains
 * queued NativeMessages onto the rail. The agent runtime is unaffected
 * — it sees a successful "send" and moves on, which mirrors how GHL's
 * conversations API works (the real send happens after the API call
 * returns).
 *
 * Pipelines/deals and calendar booking aren't part of the native plan
 * — those methods throw a clear "not available" error so the agent
 * surfaces the upgrade path instead of pretending to succeed.
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import type { Contact, Conversation, CrmUser, Message, Opportunity, SendMessagePayload } from '@/types'
import type {
  BookAppointmentPayload, CreateOpportunityPayload, CrmAdapter, CrmProvider, CustomField,
} from '../types'
import { normalizeEmail, normalizePhone } from './normalize'

const NATIVE_PREFIX = 'native:'

function notSupported(feature: string): never {
  throw new Error(
    `${feature} isn't available on the native CRM. Connect GoHighLevel or HubSpot from Integrations to use this feature.`,
  )
}

/**
 * The Location row for a native workspace is keyed `native:<workspaceId>`,
 * so the adapter only needs the workspaceId. This helper extracts it
 * defensively — if a non-native locationId ever lands here we throw
 * loudly rather than silently treating it as a workspace id.
 */
function workspaceIdFrom(locationId: string): string {
  if (!locationId.startsWith(NATIVE_PREFIX)) {
    throw new Error(`NativeAdapter received non-native locationId: ${locationId}`)
  }
  return locationId.slice(NATIVE_PREFIX.length)
}

export class NativeAdapter implements CrmAdapter {
  provider: CrmProvider = 'native'
  locationId: string
  private workspaceId: string

  constructor(locationId: string) {
    this.locationId = locationId
    this.workspaceId = workspaceIdFrom(locationId)
  }

  // ─── Contacts ────────────────────────────────────────────────────────

  async getContact(contactId: string): Promise<Contact> {
    const c = await db.nativeContact.findFirst({
      where: { id: contactId, workspaceId: this.workspaceId },
    })
    if (!c) throw new Error(`Contact not found: ${contactId}`)
    return this.toContact(c)
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const trimmed = query.trim()
    if (!trimmed) return []

    // Email/phone exact match takes precedence — that's how the agent's
    // "find by email or phone" lookups arrive — then fall back to a name
    // substring match so manual searches in the UI still work.
    const email = normalizeEmail(trimmed)
    const phone = normalizePhone(trimmed)

    const results = await db.nativeContact.findMany({
      where: {
        workspaceId: this.workspaceId,
        OR: [
          ...(email ? [{ email }] : []),
          ...(phone ? [{ phone }] : []),
          { firstName: { contains: trimmed, mode: 'insensitive' as const } },
          { lastName: { contains: trimmed, mode: 'insensitive' as const } },
        ],
      },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    })
    return results.map((c) => this.toContact(c))
  }

  async createContact(payload: Partial<Contact>): Promise<Contact> {
    const created = await db.nativeContact.create({
      data: {
        workspaceId: this.workspaceId,
        firstName: payload.firstName ?? null,
        lastName: payload.lastName ?? null,
        email: normalizeEmail(payload.email),
        phone: normalizePhone(payload.phone),
        tags: payload.tags ?? [],
        source: payload.source ?? null,
        assignedToUserId: payload.assignedTo ?? null,
        customFields: customFieldsToJson(payload.customFields),
      },
    })
    return this.toContact(created)
  }

  async updateContact(contactId: string, payload: Partial<Contact>): Promise<Contact> {
    const data: Record<string, unknown> = {}
    if (payload.firstName !== undefined) data.firstName = payload.firstName
    if (payload.lastName !== undefined) data.lastName = payload.lastName
    if (payload.email !== undefined) data.email = normalizeEmail(payload.email)
    if (payload.phone !== undefined) data.phone = normalizePhone(payload.phone)
    if (payload.tags !== undefined) data.tags = payload.tags
    if (payload.source !== undefined) data.source = payload.source
    if (payload.assignedTo !== undefined) data.assignedToUserId = payload.assignedTo
    if (payload.customFields !== undefined) data.customFields = customFieldsToJson(payload.customFields)

    const updated = await db.nativeContact.update({
      where: { id: contactId },
      data,
    })
    return this.toContact(updated)
  }

  async addTags(contactId: string, tags: string[]): Promise<void> {
    if (tags.length === 0) return
    // Read-merge-write so we get a deterministic union without a Postgres
    // array_union extension. Contacts tend to have small tag sets so the
    // round-trip cost is fine.
    const existing = await db.nativeContact.findUnique({
      where: { id: contactId },
      select: { tags: true },
    })
    if (!existing) throw new Error(`Contact not found: ${contactId}`)
    const merged = Array.from(new Set([...(existing.tags ?? []), ...tags]))
    await db.nativeContact.update({
      where: { id: contactId },
      data: { tags: merged },
    })
  }

  async updateContactField(contactId: string, fieldKey: string, value: string): Promise<void> {
    const existing = await db.nativeContact.findUnique({
      where: { id: contactId },
      select: { customFields: true },
    })
    if (!existing) throw new Error(`Contact not found: ${contactId}`)
    const current = (existing.customFields as Record<string, unknown> | null) ?? {}
    const merged = { ...current, [fieldKey]: value } as Prisma.InputJsonValue
    await db.nativeContact.update({
      where: { id: contactId },
      data: { customFields: merged },
    })
  }

  async getCustomFields(): Promise<CustomField[]> {
    const fields = await db.nativeCustomField.findMany({
      where: { workspaceId: this.workspaceId },
      orderBy: { position: 'asc' },
    })
    return fields.map((f) => ({
      id: f.id,
      name: f.name,
      fieldKey: f.fieldKey,
      dataType: f.dataType,
      placeholder: f.placeholder ?? undefined,
      position: f.position,
    }))
  }

  // ─── Conversations & Messaging ───────────────────────────────────────

  async searchConversations(opts: { contactId?: string; limit?: number } = {}): Promise<Conversation[]> {
    const conversations = await db.nativeConversation.findMany({
      where: {
        workspaceId: this.workspaceId,
        ...(opts.contactId ? { contactId: opts.contactId } : {}),
      },
      orderBy: { lastMessageAt: 'desc' },
      take: opts.limit ?? 20,
    })
    return conversations.map((c) => this.toConversation(c))
  }

  async getConversation(conversationId: string): Promise<Conversation> {
    const c = await db.nativeConversation.findFirst({
      where: { id: conversationId, workspaceId: this.workspaceId },
    })
    if (!c) throw new Error(`Conversation not found: ${conversationId}`)
    return this.toConversation(c)
  }

  async getMessages(conversationId: string, limit = 50): Promise<Message[]> {
    const messages = await db.nativeMessage.findMany({
      where: { conversationId, workspaceId: this.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return messages
      .map((m) => this.toMessage(m))
      // Reverse so callers get oldest-first, matching how the GHL adapter
      // hands back ordered turns to the agent.
      .reverse()
  }

  async sendMessage(payload: SendMessagePayload): Promise<{ messageId: string; conversationId: string }> {
    // Each (contact, channel) pair gets its own thread so SMS / email /
    // WhatsApp histories don't bleed together. There's no compound unique
    // index on (contactId, channel) since duplicate threads only split
    // history rather than corrupt anything — read paths tolerate it.
    const channel = payload.type.toLowerCase()
    const conversationId = await this.findOrCreateConversationId(payload.contactId, channel)

    const message = await db.nativeMessage.create({
      data: {
        workspaceId: this.workspaceId,
        conversationId,
        contactId: payload.contactId,
        direction: 'outbound',
        channel,
        body: payload.message,
        subject: payload.subject ?? null,
        // queued = persisted but not yet handed to the delivery rail. The
        // separate worker (Twilio/SMTP) flips this to sent/delivered/failed.
        status: 'queued',
      },
    })

    await db.nativeConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    })

    return { messageId: message.id, conversationId }
  }

  // ─── Opportunities / Deals (not on native plan) ─────────────────────

  async getOpportunitiesForContact(_contactId: string): Promise<Opportunity[]> {
    // Returning [] rather than throwing here — the agent's "list deals"
    // tool calls this on most turns and a thrown error would derail
    // unrelated runs. An empty array reads as "no deals", which is true.
    return []
  }
  async updateOpportunityStage(_opportunityId: string, _stageId: string): Promise<Opportunity> {
    notSupported('Pipelines and deals')
  }
  async createOpportunity(_payload: CreateOpportunityPayload): Promise<any> {
    notSupported('Pipelines and deals')
  }
  async updateOpportunityValue(_opportunityId: string, _monetaryValue: number): Promise<any> {
    notSupported('Pipelines and deals')
  }

  // ─── Calendar (not on native plan) ──────────────────────────────────

  async getCalendar(_calendarId: string): Promise<unknown> {
    // Native plan has no calendar concept — reference-health treats this
    // as "no calendar to validate" rather than a broken reference.
    throw new Error('getCalendar not supported by this adapter')
  }

  async getFreeSlots(): Promise<Array<{ startTime: string; endTime: string }>> {
    return []
  }
  async getCalendarTimezone(_calendarId: string): Promise<string | null> {
    return null
  }
  async bookAppointment(_payload: BookAppointmentPayload): Promise<any> {
    notSupported('Calendar booking')
  }
  async getAppointment(_eventId: string): Promise<any> {
    notSupported('Calendar booking')
  }
  async updateAppointment(_eventId: string, _payload: any): Promise<any> {
    notSupported('Calendar booking')
  }
  async getCalendarEvents(_contactId: string): Promise<any> {
    return { events: [] }
  }
  async createAppointmentNote(_appointmentId: string, _body: string): Promise<any> {
    notSupported('Calendar booking')
  }
  async updateAppointmentNote(_appointmentId: string, _noteId: string, _body: string): Promise<any> {
    notSupported('Calendar booking')
  }

  // ─── Users / Team Members ────────────────────────────────────────────

  async getUser(userId: string): Promise<CrmUser | null> {
    if (!userId) return null
    // Native plan's "user" is just the workspace member assigned to the
    // contact. Resolve through User → WorkspaceMember so the merge fields
    // {{user.name}}/{{user.email}} keep working without a CRM-specific
    // user concept.
    const member = await db.workspaceMember.findFirst({
      where: { userId, workspaceId: this.workspaceId },
      include: { user: { select: { name: true, email: true } } },
    })
    if (!member) return null
    return {
      id: userId,
      name: member.user.name ?? undefined,
      email: member.user.email ?? undefined,
    }
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  private async findOrCreateConversationId(contactId: string, channel: string): Promise<string> {
    const existing = await db.nativeConversation.findFirst({
      where: { workspaceId: this.workspaceId, contactId, channel },
      select: { id: true },
    })
    if (existing) return existing.id
    const created = await db.nativeConversation.create({
      data: { workspaceId: this.workspaceId, contactId, channel },
      select: { id: true },
    })
    return created.id
  }

  private toContact(c: {
    id: string; firstName: string | null; lastName: string | null
    email: string | null; phone: string | null; tags: string[]
    source: string | null; customFields: any; assignedToUserId: string | null
    createdAt: Date; updatedAt: Date
  }): Contact {
    const customFields = c.customFields && typeof c.customFields === 'object'
      ? Object.entries(c.customFields as Record<string, unknown>).map(([id, value]) => ({
        id,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }))
      : undefined

    return {
      id: c.id,
      locationId: this.locationId,
      firstName: c.firstName ?? undefined,
      lastName: c.lastName ?? undefined,
      name: [c.firstName, c.lastName].filter(Boolean).join(' ') || undefined,
      email: c.email ?? undefined,
      phone: c.phone ?? undefined,
      tags: c.tags ?? [],
      source: c.source ?? undefined,
      customFields,
      dateAdded: c.createdAt.toISOString(),
      dateUpdated: c.updatedAt.toISOString(),
      assignedTo: c.assignedToUserId ?? undefined,
    }
  }

  private toConversation(c: {
    id: string; contactId: string; lastMessageAt: Date | null; channel: string
    unreadCount: number
  }): Conversation {
    return {
      id: c.id,
      locationId: this.locationId,
      contactId: c.contactId,
      lastMessageDate: c.lastMessageAt?.toISOString(),
      unreadCount: c.unreadCount,
      type: c.channel,
    }
  }

  private toMessage(m: {
    id: string; conversationId: string; contactId: string; direction: string
    channel: string; body: string; status: string; createdAt: Date
    attachmentKind: string | null; attachmentUrl: string | null; attachmentName: string | null
  }): Message {
    return {
      id: m.id,
      conversationId: m.conversationId,
      locationId: this.locationId,
      contactId: m.contactId,
      body: m.body,
      direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
      status: m.status,
      messageType: m.channel,
      createdAt: m.createdAt.toISOString(),
      attachmentKind: m.attachmentKind === 'image' || m.attachmentKind === 'file'
        ? m.attachmentKind
        : undefined,
      attachmentUrl: m.attachmentUrl ?? undefined,
      attachmentName: m.attachmentName ?? undefined,
    }
  }
}

function customFieldsToJson(fields: Contact['customFields']): Record<string, string> | undefined {
  if (!fields || fields.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const f of fields) out[f.id] = f.value
  return out
}
