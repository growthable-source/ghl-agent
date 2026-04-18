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

  // Verify the visitor belongs to this widget
  const visitor = await db.widgetVisitor.findFirst({
    where: { id: visitorId, widgetId },
    select: { id: true },
  })
  if (!visitor) return NextResponse.json({ error: 'Visitor not found' }, { status: 404, headers })

  // Reuse the most recent active conversation if any
  const existing = await db.widgetConversation.findFirst({
    where: { widgetId, visitorId, status: 'active' },
    orderBy: { lastMessageAt: 'desc' },
    include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
  })
  if (existing) {
    return NextResponse.json({
      conversationId: existing.id,
      messages: existing.messages.map(m => ({
        id: m.id, role: m.role, content: m.content, kind: m.kind, createdAt: m.createdAt.toISOString(),
      })),
    }, { headers })
  }

  const conv = await db.widgetConversation.create({
    data: { widgetId, visitorId, agentId: v.widget.defaultAgentId },
  })
  return NextResponse.json({ conversationId: conv.id, messages: [] }, { headers })
}
