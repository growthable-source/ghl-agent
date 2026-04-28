import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'

type Params = { params: Promise<{ widgetId: string }> }

/**
 * POST /api/widget/:widgetId/conversations/new
 * Body: { visitorId }
 *
 * Closes the visitor's current active conversation (if any) and creates
 * a fresh active one. Used by the widget's "Start new conversation"
 * control so a returning visitor can reset their thread without losing
 * the operator's transcript history.
 */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId : null
  if (!visitorId) return NextResponse.json({ error: 'visitorId required' }, { status: 400, headers })

  const visitor = await db.widgetVisitor.findFirst({
    where: { id: visitorId, widgetId },
    select: { id: true },
  })
  if (!visitor) return NextResponse.json({ error: 'Visitor not found' }, { status: 404, headers })

  // Close any currently-active conversations for this visitor.
  await db.widgetConversation.updateMany({
    where: { widgetId, visitorId, status: 'active' },
    data: { status: 'closed' },
  })

  // Open a new one.
  const conv = await db.widgetConversation.create({
    data: { widgetId, visitorId, agentId: v.widget.defaultAgentId },
  })

  return NextResponse.json({ conversationId: conv.id, messages: [] }, { headers })
}
