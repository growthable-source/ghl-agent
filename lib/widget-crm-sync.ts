/**
 * Widget ↔ GHL bridge.
 *
 * When a workspace has a real CRM connected, widget visitors should land
 * as proper Contacts in GHL — and conversations should leave a trail of
 * tags + a follow-up task that links back to our inbox so operators
 * working in GHL can find the chat.
 *
 * Native unified-inbox sync requires GHL "Custom Conversation Provider"
 * marketplace approval; this module is the bridge that works *today*
 * without that approval. Apply for it later for proper inbox integration.
 *
 * All functions are best-effort. Failures log but never throw — a CRM
 * blip must not break the visitor's chat flow.
 */

import { db } from './db'
import type { CrmAdapter } from './crm/types'

const TAG_CHAT_STARTED = 'widget-chat-started'
const TAG_HANDED_OFF   = 'widget-handed-off'
const TAG_RESOLVED     = 'widget-resolved'

/**
 * Resolve a real (non-placeholder) GHL adapter for this workspace, or
 * null if no CRM is connected. Cached per call; reuses the existing
 * factory + placeholder guard.
 */
async function resolveAdapter(workspaceId: string): Promise<CrmAdapter | null> {
  try {
    const realLocation = await db.location.findFirst({
      where: { workspaceId, crmProvider: { not: 'none' } },
      select: { id: true },
      orderBy: { installedAt: 'desc' },
    })
    if (!realLocation) return null
    const { getCrmAdapter } = await import('./crm/factory')
    return await getCrmAdapter(realLocation.id)
  } catch (err: any) {
    console.warn('[widget-crm-sync] adapter resolve failed:', err?.message)
    return null
  }
}

interface VisitorLike {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  crmContactId: string | null
}

/**
 * Upsert the GHL Contact for a widget visitor and stash the result on
 * WidgetVisitor.crmContactId. Idempotent — repeated calls re-resolve to
 * the same contact via email/phone match.
 *
 * Returns the resolved CRM contact ID, or null if nothing was synced
 * (no email/phone yet, no CRM connected, or the call failed).
 */
export async function syncContactFromVisitor(workspaceId: string, visitor: VisitorLike): Promise<string | null> {
  if (!visitor.email && !visitor.phone) return null
  if (visitor.crmContactId) return visitor.crmContactId

  const adapter = await resolveAdapter(workspaceId)
  if (!adapter) return null

  // upsertContact lives on the GHL/HubSpot adapter implementations but
  // not on the CrmAdapter interface — duck-type to call it.
  const upsert = (adapter as any).upsertContact as
    | ((p: any) => Promise<{ contact: { id: string } }>)
    | undefined
  if (typeof upsert !== 'function') return null

  try {
    const { contact } = await upsert.call(adapter, {
      email: visitor.email || undefined,
      phone: visitor.phone || undefined,
      ...(visitor.name ? splitName(visitor.name) : {}),
      source: 'widget',
      tags: ['widget-visitor'],
    })
    const crmContactId = contact.id
    if (crmContactId) {
      await db.widgetVisitor.update({
        where: { id: visitor.id },
        data: { crmContactId },
      }).catch(() => {})
      return crmContactId
    }
  } catch (err: any) {
    console.warn('[widget-crm-sync] upsertContact failed:', err?.message)
  }
  return null
}

function splitName(full: string): { firstName?: string; lastName?: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function deepLinkFor(workspaceId: string, conversationId: string): string {
  const base = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  return `${base}/dashboard/${workspaceId}/inbox/${conversationId}`
}

/**
 * Fired from the first visitor message in a conversation.
 *
 * Upserts the contact (in case the visitor already had identity), tags
 * with widget-chat-started, and creates a follow-up task carrying a
 * deep link back to our inbox. Operators living in GHL see the contact
 * pop up with a "Review the chat →" action.
 */
export async function tagAndTaskOnFirstMessage(params: {
  workspaceId: string
  visitor: VisitorLike
  conversationId: string
  widgetName: string
  firstMessage: string
}) {
  const { workspaceId, visitor, conversationId, widgetName, firstMessage } = params
  const adapter = await resolveAdapter(workspaceId)
  if (!adapter) return

  let crmContactId = visitor.crmContactId
  if (!crmContactId) {
    crmContactId = await syncContactFromVisitor(workspaceId, visitor)
  }
  if (!crmContactId) return

  try { await adapter.addTags(crmContactId, [TAG_CHAT_STARTED]) }
  catch (err: any) { console.warn('[widget-crm-sync] addTags chat-started:', err?.message) }

  try {
    if (typeof (adapter as any).createContactTask === 'function') {
      const link = deepLinkFor(workspaceId, conversationId)
      const preview = firstMessage.length > 200 ? firstMessage.slice(0, 197) + '…' : firstMessage
      await (adapter as any).createContactTask(crmContactId, {
        title: `New widget chat from ${widgetName}`,
        body: `Visitor opened a chat:\n\n"${preview}"\n\nReview the live conversation: ${link}`,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
    }
  } catch (err: any) {
    console.warn('[widget-crm-sync] createContactTask:', err?.message)
  }
}

/** Operator took over — tag the contact so the GHL view reflects it. */
export async function tagOnHandover(workspaceId: string, visitor: VisitorLike) {
  const adapter = await resolveAdapter(workspaceId)
  if (!adapter) return
  let crmContactId = visitor.crmContactId
  if (!crmContactId) crmContactId = await syncContactFromVisitor(workspaceId, visitor)
  if (!crmContactId) return
  try { await adapter.addTags(crmContactId, [TAG_HANDED_OFF]) }
  catch (err: any) { console.warn('[widget-crm-sync] addTags handed-off:', err?.message) }
}

/**
 * Conversation closed. Tag the contact and write a transcript summary
 * note so the operator has a permanent record on the contact in GHL.
 *
 * Best-effort transcript: takes the last ~30 messages and renders them
 * as a compact text log. If the conversation is huge, GHL will still
 * accept large notes (up to ~64 KB last we checked).
 */
export async function tagAndNoteOnResolve(params: {
  workspaceId: string
  visitor: VisitorLike
  conversationId: string
  widgetName: string
}) {
  const { workspaceId, visitor, conversationId, widgetName } = params
  const adapter = await resolveAdapter(workspaceId)
  if (!adapter) return

  let crmContactId = visitor.crmContactId
  if (!crmContactId) crmContactId = await syncContactFromVisitor(workspaceId, visitor)
  if (!crmContactId) return

  try { await adapter.addTags(crmContactId, [TAG_RESOLVED]) }
  catch (err: any) { console.warn('[widget-crm-sync] addTags resolved:', err?.message) }

  try {
    if (typeof (adapter as any).createContactNote === 'function') {
      const messages = await db.widgetMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: { role: true, content: true, kind: true, createdAt: true },
      })
      const transcript = messages.map(m => {
        const who = m.role === 'visitor' ? 'Visitor' : m.role === 'agent' ? 'Agent' : '—'
        const body = m.kind === 'image' ? `[image: ${m.content}]`
          : m.kind === 'file' ? `[file: ${m.content}]`
          : m.content
        return `${who}: ${body}`
      }).join('\n\n')
      const link = deepLinkFor(workspaceId, conversationId)
      await (adapter as any).createContactNote(
        crmContactId,
        `Chat from ${widgetName} resolved.\n\nFull thread: ${link}\n\n— Transcript —\n${transcript.slice(0, 60_000)}`,
      )
    }
  } catch (err: any) {
    console.warn('[widget-crm-sync] createContactNote:', err?.message)
  }
}
