import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * GET — enriched CRM data for the contact behind this widget visitor,
 * if any. Powers the right-sidebar "CRM" section in the inbox.
 *
 * Best-effort. If the workspace has no CRM connected OR the visitor
 * isn't tied to a contact yet, returns { connected: false } and the
 * sidebar shows a quiet hint instead of stuff that doesn't exist.
 *
 * Shape:
 *   {
 *     connected: true,
 *     contact: { id, name, email, phone, tags, dateAdded, source, … },
 *     opportunities: [{ id, name, stage, value, status }],
 *     notes: [{ id, body, dateAdded }],
 *     tasks: [{ id, title, dueDate, completed }],
 *     deepLink: '<crm-url>',   // when known (GHL location)
 *   }
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: {
      id: true,
      visitor: { select: { id: true, crmContactId: true, email: true, phone: true } },
    },
  })
  if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!convo.visitor.crmContactId) {
    return NextResponse.json({ connected: false, reason: 'no-crm-contact' })
  }

  // Find the workspace's primary CRM location to call against.
  const location: any = await (db.location as any).findFirst({
    where: { workspaceId, crmProvider: { not: 'none' } },
    select: { id: true, crmProvider: true },
    orderBy: { installedAt: 'desc' },
  }).catch(() => null)
  if (!location) {
    return NextResponse.json({ connected: false, reason: 'no-crm-connected' })
  }

  let adapter: any
  try {
    const { getCrmAdapter } = await import('@/lib/crm/factory')
    adapter = await getCrmAdapter(location.id as string)
  } catch {
    return NextResponse.json({ connected: false, reason: 'adapter-unavailable' })
  }

  const contactId = convo.visitor.crmContactId

  // Fan-out: pull every relevant view of the contact in parallel and
  // tolerate per-call failures so one outage doesn't blank out the
  // whole panel.
  const [contactRes, oppsRes, notesRes, tasksRes] = await Promise.allSettled([
    adapter.getContact?.(contactId) ?? Promise.resolve(null),
    adapter.getOpportunitiesForContact?.(contactId) ?? Promise.resolve([]),
    adapter.getContactNotes?.(contactId) ?? Promise.resolve([]),
    adapter.getContactTasks?.(contactId) ?? Promise.resolve([]),
  ])

  const contact = contactRes.status === 'fulfilled' ? contactRes.value : null
  const opportunities = oppsRes.status === 'fulfilled' && Array.isArray(oppsRes.value) ? oppsRes.value : []
  const notes = notesRes.status === 'fulfilled' && Array.isArray(notesRes.value) ? notesRes.value : []
  const tasks = tasksRes.status === 'fulfilled' && Array.isArray(tasksRes.value) ? tasksRes.value : []

  // Build a deep-link to the CRM contact when we know the provider.
  // GHL: app.gohighlevel.com/v2/location/<locationId>/contacts/detail/<contactId>
  let deepLink: string | null = null
  if ((location as any).crmProvider === 'ghl') {
    deepLink = `https://app.gohighlevel.com/v2/location/${location.id}/contacts/detail/${contactId}`
  }

  return NextResponse.json({
    connected: true,
    provider: (location as any).crmProvider,
    deepLink,
    contact: contact ? {
      id: contact.id,
      firstName: contact.firstName ?? null,
      lastName: contact.lastName ?? null,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || contact.contactName || null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      tags: Array.isArray(contact.tags) ? contact.tags : [],
      source: contact.source ?? null,
      dateAdded: contact.dateAdded ?? null,
      assignedTo: contact.assignedTo ?? null,
    } : null,
    opportunities: opportunities.slice(0, 10).map((o: any) => ({
      id: o.id,
      name: o.name,
      stage: o.stage ?? o.pipelineStageId ?? null,
      pipelineId: o.pipelineId ?? null,
      monetaryValue: o.monetaryValue ?? null,
      status: o.status ?? null,
    })),
    notes: notes.slice(0, 10).map((n: any) => ({
      id: n.id,
      body: typeof n.body === 'string' ? n.body.slice(0, 600) : '',
      dateAdded: n.dateAdded ?? null,
    })),
    tasks: tasks.slice(0, 10).map((t: any) => ({
      id: t.id,
      title: t.title ?? t.body ?? '',
      dueDate: t.dueDate ?? null,
      completed: !!t.completed,
    })),
  })
}
