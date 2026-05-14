import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'

type Params = { params: Promise<{ widgetId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: widgetCorsHeaders(req.headers.get('origin')),
  })
}

/**
 * POST /api/widget/:widgetId/conversations
 * Body: { visitorId }
 *
 * Creates (or returns the active) conversation for this visitor.
 * If an active conversation already exists, we return it so the visitor
 * doesn't fork their thread on every page load.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId : null
  if (!visitorId) return NextResponse.json({ error: 'visitorId required' }, { status: 400, headers })

  // Optional context the widget sends about where the chat started.
  // Captured once at conversation-create time; never updated.
  const initiatedUrl =
    typeof body.initiatedUrl === 'string' && body.initiatedUrl.length > 0
      ? body.initiatedUrl.slice(0, 2000)
      : null
  const initiatedTitle =
    typeof body.initiatedTitle === 'string' && body.initiatedTitle.length > 0
      ? body.initiatedTitle.slice(0, 300)
      : null

  // Verify the visitor belongs to this widget. Pull currentUrl/Title as a
  // fallback so a widget that didn't send initiatedUrl still gets one
  // populated from the latest page_view we recorded.
  const visitor = await db.widgetVisitor.findFirst({
    where: { id: visitorId, widgetId },
    select: { id: true, currentUrl: true, currentTitle: true } as any,
  }) as any
  if (!visitor) return NextResponse.json({ error: 'Visitor not found' }, { status: 404, headers })

  // Reuse the most recent conversation that hasn't been explicitly
  // ended. Both 'active' (AI is driving) and 'handed_off' (an operator
  // jumped in) are valid threads the visitor should resume on refresh —
  // we used to filter on status='active' only, which meant the moment
  // an operator clicked "Jump in" in the inbox the widget lost its
  // reference on the next page reload and silently spun up a fresh
  // empty thread. The operator's reply still landed on the original
  // (handed_off) row, so visitors saw nothing until full reset.
  //
  // 'ended' stays excluded — that's the operator marking resolved /
  // closing the thread, where a fresh thread on refresh IS the intent.
  const existing = await db.widgetConversation.findFirst({
    where: { widgetId, visitorId, status: { in: ['active', 'handed_off'] } },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 50 },
      assignedUser: { select: { name: true, email: true, image: true } },
    },
  })
  if (existing) {
    return NextResponse.json({
      conversationId: existing.id,
      status: existing.status,
      assignedUser: existing.assignedUser ? visitorFacingAssignee(existing.assignedUser) : null,
      messages: existing.messages.map(m => ({
        id: m.id, role: m.role, content: m.content, kind: m.kind, createdAt: m.createdAt.toISOString(),
      })),
    }, { headers })
  }

  // Fall back to whatever currentUrl we already have for this visitor if
  // the widget didn't send one explicitly. Better than leaving the column
  // null when we know the answer.
  const startUrl = initiatedUrl ?? (visitor.currentUrl as string | null) ?? null
  const startTitle = initiatedTitle ?? (visitor.currentTitle as string | null) ?? null

  let conv
  try {
    conv = await db.widgetConversation.create({
      data: {
        widgetId,
        visitorId,
        agentId: v.widget.defaultAgentId,
        initiatedUrl: startUrl,
        initiatedTitle: startTitle,
      } as any,
    })
  } catch (err: any) {
    // Pre-migration: initiatedUrl/Title columns may not exist yet.
    // Degrade gracefully so live chat keeps working until the SQL runs.
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      conv = await db.widgetConversation.create({
        data: { widgetId, visitorId, agentId: v.widget.defaultAgentId },
      })
    } else { throw err }
  }
  return NextResponse.json({ conversationId: conv.id, status: conv.status, assignedUser: null, messages: [] }, { headers })
}

/**
 * Strip operator PII (email) before sending across the wire to the
 * visitor's browser. The widget shows "You're chatting with {name}"
 * and a small avatar — that's all the visitor needs to know.
 */
function visitorFacingAssignee(u: { name: string | null; email: string | null; image: string | null }) {
  // Prefer first name only if we have a full name like "Jane Smith".
  // Keeps the widget UX casual without exposing surnames to anonymous
  // visitors. Falls back to the local-part of the email if name is
  // empty, never to the full email.
  const fullName = (u.name || '').trim()
  const displayName = fullName
    ? fullName.split(/\s+/)[0]
    : (u.email ? u.email.split('@')[0] : 'a teammate')
  return { name: displayName, image: u.image }
}
