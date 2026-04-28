import { NextRequest, NextResponse } from 'next/server'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { broadcast } from '@/lib/widget-sse'

type Params = { params: Promise<{ widgetId: string; conversationId: string }> }

/**
 * POST /api/widget/:widgetId/conversations/:conversationId/typing
 * Body: { isTyping: boolean }
 *
 * Visitor's typing indicator. Pure broadcast — no DB write. Operators
 * subscribed to the SSE stream see "visitor is typing…" so they know
 * a message is coming and don't fire follow-up nudges.
 */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId, conversationId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const isTyping = !!body.isTyping
  broadcast(conversationId, { type: 'visitor_typing', isTyping })
  return NextResponse.json({ ok: true }, { headers })
}
