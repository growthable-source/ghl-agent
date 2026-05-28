/**
 * WidgetAdapter — satisfies CrmAdapter but intercepts outbound messaging so
 * agent replies flow over our SSE stream to the browser widget instead of
 * going out through GHL/HubSpot.
 *
 * Calendar + opportunity methods delegate to an optional underlying CRM
 * adapter (if the workspace has a CRM connected). That lets widget visitors
 * still book real appointments etc. once they've shared their contact info.
 * Contact ops are stubbed — widget visitors live in WidgetVisitor, not in
 * the CRM unless they explicitly convert.
 */

import type {
  CrmAdapter, CrmProvider, CustomField,
  BookAppointmentPayload, CreateOpportunityPayload,
} from './crm/types'
import type {
  Contact, Conversation, CrmUser, Message, Opportunity, SendMessagePayload,
} from '@/types'
import { db } from './db'
import { broadcast } from './widget-sse'

export class WidgetAdapter implements CrmAdapter {
  provider: CrmProvider = 'ghl'   // pretend to be GHL so tool gating behaves normally
  locationId: string              // synthetic: "widget:<widgetId>"
  conversationId: string           // WidgetConversation.id
  inner: CrmAdapter | null         // optional real CRM for calendar/opportunity passthrough

  constructor(params: {
    widgetId: string
    conversationId: string
    inner?: CrmAdapter | null
  }) {
    this.locationId = `widget:${params.widgetId}`
    this.conversationId = params.conversationId
    this.inner = params.inner ?? null
  }

  // ─── Messaging — the whole reason this adapter exists ────────────────

  async sendMessage(payload: SendMessagePayload): Promise<{ messageId: string; conversationId: string }> {
    // Strip the optional <quickReplies>opt1|opt2|opt3</quickReplies> marker
    // (see lib/widget-agent-runner.ts prompt) so the visitor sees clean
    // text + a row of button chips. Up to 6 chips, each ≤60 chars.
    const QR_RE = /<quickReplies>([\s\S]*?)<\/quickReplies>/i
    const m = payload.message.match(QR_RE)
    let cleanMessage = payload.message.replace(QR_RE, '').trim()
    const quickReplies = m
      ? m[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 6).map(s => s.slice(0, 60))
      : null

    // Pull <productCard>gid</productCard> markers out of the reply (max
    // 3, taught in commerceBlock). We expand them into separate
    // kind='product' messages AFTER the text bubble so the widget UI
    // renders text first, then cards beneath — same flow as image/file
    // attachments. Channels other than the widget never see this
    // adapter, so the marker is naturally stripped from SMS/voice/etc.
    const PC_RE = /<productCard>\s*([^<\s]+)\s*<\/productCard>/gi
    const productCardIds: string[] = []
    for (const match of cleanMessage.matchAll(PC_RE)) {
      const gid = match[1]
      if (gid && productCardIds.length < 3) productCardIds.push(gid)
    }
    cleanMessage = cleanMessage.replace(PC_RE, '').replace(/\s{2,}/g, ' ').trim()

    const finalMessage = cleanMessage || payload.message

    // Persist the outbound reply (cleaned)
    const msg = await db.widgetMessage.create({
      data: {
        conversationId: this.conversationId,
        role: 'agent',
        content: finalMessage,
        kind: 'text',
      },
    })
    await db.widgetConversation.update({
      where: { id: this.conversationId },
      data: { lastMessageAt: new Date() },
    })

    // Push to every SSE subscriber listening to this conversation. Awaited
    // so the NOTIFY lands before the agent loop moves on / suspends.
    await broadcast(this.conversationId, {
      type: 'agent_message',
      id: msg.id,
      content: finalMessage,
      createdAt: msg.createdAt.toISOString(),
      ...(quickReplies && quickReplies.length > 0 ? { quickReplies } : {}),
    })

    // Detect-and-translate AFTER the broadcast so the visitor sees
    // the original reply without waiting on Haiku. Awaited so the
    // call actually completes on serverless — a floating promise
    // could be killed when the agent loop returns. Adds ~1s to the
    // agent's next tool call; the visitor's reply path is unaffected.
    try {
      const { translateMessageInBackground } = await import('./widget-translation')
      await translateMessageInBackground(msg.id)
    } catch { /* logged inside helper */ }

    // Expand product cards AFTER the text bubble. Errors here never
    // block the main reply — the customer sees the text, the card just
    // doesn't render. Each card is its own WidgetMessage (kind=product)
    // with JSON content the widget renderer parses.
    if (productCardIds.length > 0) {
      await this.expandProductCards(productCardIds).catch(err => {
        console.warn('[widget] product card expansion failed:', err?.message)
      })
    }

    return { messageId: msg.id, conversationId: this.conversationId }
  }

  /**
   * Look up workspaceId via the widget row, resolve the commerce
   * adapter, fetch each product, and emit a kind='product' WidgetMessage
   * + SSE broadcast per successful lookup. Misses (deleted/unpublished
   * products) are silently skipped — the agent's text already mentioned
   * the product by name, so a missing card is degraded but not broken.
   */
  private async expandProductCards(productIds: string[]): Promise<void> {
    // widgetId is stashed in locationId as "widget:<id>"
    const widgetId = this.locationId.startsWith('widget:')
      ? this.locationId.slice('widget:'.length)
      : null
    if (!widgetId) return

    const widget = await db.chatWidget.findUnique({
      where: { id: widgetId },
      select: { workspaceId: true },
    })
    if (!widget?.workspaceId) return

    const { getCommerceAdapter } = await import('./commerce/factory')
    const shop = await getCommerceAdapter(widget.workspaceId)
    if (!shop) return

    for (const gid of productIds) {
      try {
        const card = await shop.getProductCardByGid(gid)
        if (!card) continue
        const cardMsg = await db.widgetMessage.create({
          data: {
            conversationId: this.conversationId,
            role: 'agent',
            content: JSON.stringify(card),
            kind: 'product',
          },
        })
        await broadcast(this.conversationId, {
          type: 'agent_message',
          id: cardMsg.id,
          content: cardMsg.content,
          kind: 'product',
          createdAt: cardMsg.createdAt.toISOString(),
        })
      } catch (err: any) {
        console.warn(`[widget] product card lookup failed for ${gid}: ${err?.message}`)
      }
    }
  }

  /**
   * Operator-visible system note. Use for tool-level failures the agent
   * shouldn't apologize for (calendar misconfiguration, scope drift,
   * etc.) — surfaces inline in the widget transcript so the inbox view
   * shows exactly what went wrong on the server.
   */
  async broadcastSystem(content: string): Promise<void> {
    try {
      const msg = await db.widgetMessage.create({
        data: {
          conversationId: this.conversationId,
          role: 'system',
          content,
          kind: 'text',
        },
      })
      await broadcast(this.conversationId, {
        type: 'agent_message',
        id: msg.id,
        content,
        createdAt: msg.createdAt.toISOString(),
      })
    } catch (err: any) {
      console.warn('[WidgetAdapter] broadcastSystem failed:', err?.message)
    }
  }

  // ─── Contact ops — stubbed (widget visitors aren't CRM contacts) ──────

  async getContact(_contactId: string): Promise<Contact> {
    return { id: _contactId, firstName: 'Visitor', lastName: null, email: null, phone: null, tags: [], source: 'widget' } as any
  }
  async searchContacts(_query: string): Promise<Contact[]> { return [] }
  async createContact(payload: Partial<Contact>): Promise<Contact> {
    return { id: `visitor-${Date.now()}`, firstName: payload.firstName ?? null, lastName: payload.lastName ?? null, email: payload.email ?? null, phone: payload.phone ?? null, tags: [], source: 'widget' } as any
  }
  async updateContact(contactId: string, _payload: Partial<Contact>): Promise<Contact> {
    return this.getContact(contactId)
  }
  async addTags(_contactId: string, tags: string[]): Promise<void> {
    // Best-effort: store tags on the visitor's email if we have one (future)
    console.log(`[widget] addTags ignored (widget visitor has no CRM contact):`, tags)
  }
  async updateContactField(_contactId: string, fieldKey: string, value: string): Promise<void> {
    console.log(`[widget] updateContactField ignored:`, fieldKey, value)
  }
  async getCustomFields(): Promise<CustomField[]> {
    return this.inner?.getCustomFields() ?? []
  }

  // ─── Conversations ───────────────────────────────────────────────────

  async searchConversations(): Promise<Conversation[]> { return [] }
  async getConversation(conversationId: string): Promise<Conversation> {
    return { id: conversationId, contactId: '', lastMessageAt: new Date().toISOString() } as any
  }
  async getMessages(conversationId: string, limit = 20): Promise<Message[]> {
    const msgs = await db.widgetMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    return msgs.map(m => ({
      id: m.id,
      conversationId,
      locationId: this.locationId,
      contactId: '',
      body: m.content,
      direction: m.role === 'visitor' ? 'inbound' as const : 'outbound' as const,
    })) as any
  }

  // ─── Opportunities — passthrough if real CRM connected, else stub ─────

  async getOpportunitiesForContact(contactId: string): Promise<Opportunity[]> {
    return this.inner?.getOpportunitiesForContact(contactId) ?? []
  }
  async updateOpportunityStage(opportunityId: string, stageId: string): Promise<Opportunity> {
    if (this.inner) return this.inner.updateOpportunityStage(opportunityId, stageId)
    throw new Error('No CRM connected — cannot update opportunity from widget')
  }
  async createOpportunity(payload: CreateOpportunityPayload): Promise<any> {
    if (this.inner) return this.inner.createOpportunity(payload)
    throw new Error('No CRM connected — cannot create opportunity from widget')
  }
  async updateOpportunityValue(opportunityId: string, monetaryValue: number): Promise<any> {
    if (this.inner) return this.inner.updateOpportunityValue(opportunityId, monetaryValue)
    throw new Error('No CRM connected')
  }

  // ─── Calendar — passthrough to real CRM if available ──────────────────

  async getCalendar(calendarId: string): Promise<unknown> {
    if (!this.inner) throw new Error('No CRM connected — calendar unavailable')
    return this.inner.getCalendar(calendarId)
  }

  async getFreeSlots(calendarId: string, startDate: string, endDate: string, timezone?: string) {
    if (!this.inner) throw new Error('No CRM connected — calendar unavailable')
    return this.inner.getFreeSlots(calendarId, startDate, endDate, timezone)
  }
  async getCalendarTimezone(calendarId: string): Promise<string | null> {
    if (!this.inner) return null
    return this.inner.getCalendarTimezone(calendarId)
  }
  async bookAppointment(payload: BookAppointmentPayload): Promise<any> {
    if (!this.inner) throw new Error('No CRM connected — cannot book appointments from widget')
    return this.inner.bookAppointment(payload)
  }
  async getAppointment(eventId: string): Promise<any> {
    if (!this.inner) return { id: eventId }
    return this.inner.getAppointment(eventId)
  }
  async updateAppointment(eventId: string, payload: any): Promise<any> {
    if (!this.inner) throw new Error('No CRM connected')
    return this.inner.updateAppointment(eventId, payload)
  }
  async getCalendarEvents(contactId: string): Promise<any> {
    return this.inner?.getCalendarEvents(contactId) ?? { events: [] }
  }
  async createAppointmentNote(appointmentId: string, body: string): Promise<any> {
    if (!this.inner) return { success: false, note: 'No CRM — note skipped' }
    return this.inner.createAppointmentNote(appointmentId, body)
  }
  async updateAppointmentNote(appointmentId: string, noteId: string, body: string): Promise<any> {
    if (!this.inner) return { success: false }
    return this.inner.updateAppointmentNote(appointmentId, noteId, body)
  }

  // Widget visitors don't have an assigned CRM user of their own, but if a
  // real CRM is wrapped we pass through so widget-hosted agents can still
  // render {{user.*}} tokens when they eventually interact with real contacts.
  async getUser(userId: string): Promise<CrmUser | null> {
    return this.inner?.getUser ? this.inner.getUser(userId) : null
  }
}
