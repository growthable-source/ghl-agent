import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { broadcast } from '@/lib/widget-sse'

type Params = { params: Promise<{ widgetId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: widgetCorsHeaders(req.headers.get('origin')),
  })
}

/**
 * POST /api/widget/:widgetId/voice/end
 * Body: { callId, durationSecs?, vapiCallId? }
 *
 * Called by the widget when the visitor hangs up. The actual VAPI
 * end-of-call-report webhook handles transcript + duration separately;
 * this endpoint just flips status and broadcasts a UI event.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const callId = typeof body.callId === 'string' ? body.callId : null
  if (!callId) return NextResponse.json({ error: 'callId required' }, { status: 400, headers })

  const call = await db.widgetVoiceCall.findUnique({
    where: { id: callId },
    include: { conversation: { select: { id: true, widgetId: true } } },
  })
  if (!call || call.conversation.widgetId !== widgetId) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404, headers })
  }

  await db.widgetVoiceCall.update({
    where: { id: callId },
    data: {
      status: 'ended',
      endedAt: new Date(),
      ...(typeof body.durationSecs === 'number' ? { durationSecs: body.durationSecs } : {}),
      ...(typeof body.vapiCallId === 'string' ? { vapiCallId: body.vapiCallId } : {}),
    },
  })

  await broadcast(call.conversation.id, { type: 'voice_ended', callId })
  return NextResponse.json({ success: true }, { headers })
}
