import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

/**
 * GET — chronological activity timeline for the visitor of this
 * conversation. Powers the right-sidebar "Timeline" section in the
 * inbox detail view.
 *
 * Returns:
 *   {
 *     visitor: { id, name, email, currentUrl, currentTitle, … },
 *     events: [{ id, kind, data, createdAt }],   // newest first
 *     conversations: [{ id, status, createdAt, lastMessageAt, … }]
 *   }
 *
 * Events are capped at 100 by default — the timeline is for context,
 * not deep audit. For deep-archive lookups, use the brand transcripts
 * export.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const take = Math.min(200, Math.max(10, parseInt(url.searchParams.get('limit') || '100', 10) || 100))

  // Verify the conversation belongs to this workspace + grab the
  // visitorId so we can pull their full event stream.
  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: {
      id: true,
      visitorId: true,
      visitor: {
        select: {
          id: true, name: true, email: true, phone: true,
          firstSeenAt: true, lastSeenAt: true,
          crmContactId: true,
          // currentUrl/currentTitle may not exist pre-migration —
          // wrapped below in a try/catch fallback.
        } as any,
      },
    },
  })
  if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Re-fetch the visitor with the post-migration columns. If the
  // migration hasn't run, this throws and we degrade to the basic
  // visitor shape we already have.
  let visitor: any = convo.visitor
  try {
    const richer = await (db as any).widgetVisitor.findUnique({
      where: { id: convo.visitorId },
      select: {
        id: true, name: true, email: true, phone: true,
        firstSeenAt: true, lastSeenAt: true, crmContactId: true,
        currentUrl: true, currentTitle: true,
      },
    })
    if (richer) visitor = richer
  } catch { /* migration pending — keep what we have */ }

  // Pull events + every conversation this visitor has had so the
  // sidebar can show the full multi-chat history (Intercom-style).
  let events: any[] = []
  try {
    events = await (db as any).widgetVisitorEvent.findMany({
      where: { visitorId: convo.visitorId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, kind: true, data: true, createdAt: true },
    })
  } catch (err: any) {
    if (err?.code !== 'P2021' && !/relation .* does not exist/i.test(err?.message ?? '')) throw err
  }

  let conversations: any[] = []
  try {
    conversations = await db.widgetConversation.findMany({
      where: { visitorId: convo.visitorId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, status: true, createdAt: true, lastMessageAt: true,
        widget: { select: { id: true, name: true } },
        _count: { select: { messages: true } },
      },
    })
  } catch { /* keep empty */ }

  return NextResponse.json({
    visitor: {
      id: visitor.id,
      name: visitor.name,
      email: visitor.email,
      phone: visitor.phone,
      crmContactId: visitor.crmContactId ?? null,
      firstSeenAt: visitor.firstSeenAt?.toISOString() ?? null,
      lastSeenAt: visitor.lastSeenAt?.toISOString() ?? null,
      currentUrl: visitor.currentUrl ?? null,
      currentTitle: visitor.currentTitle ?? null,
    },
    events: events.map(e => ({
      id: e.id,
      kind: e.kind,
      data: e.data,
      createdAt: e.createdAt.toISOString(),
    })),
    conversations: conversations.map(c => ({
      id: c.id,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      lastMessageAt: c.lastMessageAt.toISOString(),
      messageCount: c._count?.messages ?? 0,
      widget: c.widget,
    })),
  })
}
