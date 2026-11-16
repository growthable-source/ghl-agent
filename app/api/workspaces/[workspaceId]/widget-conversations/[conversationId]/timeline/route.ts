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
 * Events are capped at 40 by default — the timeline is for context,
 * not deep audit. For deep-archive lookups, use the brand transcripts
 * export. Only the jsonb keys the sidebar renders (url, title, email,
 * name) are selected; the rest of `data` stays in the database.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const take = Math.min(80, Math.max(10, parseInt(url.searchParams.get('limit') || '40', 10) || 40))

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
  // Project the few jsonb keys the sidebar paints instead of shipping
  // the whole `data` document. WidgetVisitorEvent is the large table
  // (page-view history); this endpoint is opened with every conversation.
  let events: Array<{
    id: string
    kind: string
    createdAt: Date
    url: string | null
    title: string | null
    email: string | null
    name: string | null
  }> = []
  try {
    events = await db.$queryRaw`
      SELECT "id", "kind", "createdAt",
             "data"->>'url' AS url,
             "data"->>'title' AS title,
             "data"->>'email' AS email,
             "data"->>'name' AS name
      FROM "WidgetVisitorEvent"
      WHERE "visitorId" = ${convo.visitorId}
      ORDER BY "createdAt" DESC
      LIMIT ${take}
    `
  } catch (err: any) {
    if (err?.code !== 'P2021' && !/does not exist/i.test(err?.message ?? '')) throw err
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
      data: {
        ...(e.url ? { url: e.url } : {}),
        ...(e.title ? { title: e.title } : {}),
        ...(e.email ? { email: e.email } : {}),
        ...(e.name ? { name: e.name } : {}),
      },
      createdAt: new Date(e.createdAt).toISOString(),
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
