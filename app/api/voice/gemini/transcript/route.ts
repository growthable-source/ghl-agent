import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'

interface TurnIn {
  role?: string
  text?: string
}

/**
 * POST persist a finished Gemini voice call's transcript + duration.
 *
 * Two surfaces share one route:
 *  - dashboard test call: { agentId, durationSecs, turns } → CallLog row
 *    (direction 'inbound', triggerSource 'gemini-test', status 'completed').
 *  - widget call: { widgetId, callId, durationSecs, turns } → updates the
 *    existing WidgetVoiceCall row (created by the widget token route).
 *
 * Turns are rendered to a plain "Role: text" transcript string — the same
 * shape CallLog.transcript / WidgetVoiceCall.transcript already store, so
 * inbox + portal render Gemini voice calls with no special-casing.
 */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

function renderTranscript(turns: TurnIn[]): string {
  return turns
    .filter(t => typeof t.text === 'string' && t.text!.trim())
    .map(t => {
      const role = t.role === 'agent' ? 'Agent' : t.role === 'user' ? 'Caller' : (t.role || 'system')
      return `${role}: ${t.text!.trim()}`
    })
    .join('\n')
    .slice(0, 100000)
}

export async function POST(req: NextRequest) {
  const cors = widgetCorsHeaders(req.headers.get('origin'))
  const body = (await req.json().catch(() => ({}))) as {
    agentId?: string
    widgetId?: string
    callId?: string
    durationSecs?: number
    turns?: TurnIn[]
  }
  const turns = Array.isArray(body.turns) ? body.turns.slice(0, 500) : []
  const durationSecs =
    typeof body.durationSecs === 'number' && body.durationSecs >= 0
      ? Math.round(body.durationSecs)
      : null
  const transcript = renderTranscript(turns)

  // ── Widget surface ──
  if (body.widgetId && body.callId) {
    const v = await validateWidgetRequest(req, body.widgetId)
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers: cors })

    // Ensure the call row belongs to a conversation on THIS widget.
    const call = await db.widgetVoiceCall.findFirst({
      where: { id: body.callId, conversation: { widgetId: body.widgetId } },
      select: { id: true },
    })
    if (!call) return NextResponse.json({ error: 'Call not found' }, { status: 404, headers: cors })

    await db.widgetVoiceCall.update({
      where: { id: call.id },
      data: { status: 'completed', endedAt: new Date(), durationSecs, transcript },
    })
    return NextResponse.json({ ok: true }, { headers: cors })
  }

  // ── Dashboard surface ──
  const agentId = typeof body.agentId === 'string' ? body.agentId : ''
  if (!agentId) return NextResponse.json({ error: 'agentId or widgetId+callId required' }, { status: 400, headers: cors })

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: { id: true, locationId: true, workspaceId: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404, headers: cors })

  const session = await auth()
  if (!session?.user?.id || !agent.workspaceId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: cors })
  }
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: agent.workspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'Access denied' }, { status: 403, headers: cors })

  const log = await db.callLog.create({
    data: {
      locationId: agent.locationId,
      agentId: agent.id,
      direction: 'inbound',
      status: 'completed',
      durationSecs,
      transcript,
      endedReason: 'gemini_test_ended',
      triggerSource: 'gemini-test',
    },
  })
  return NextResponse.json({ ok: true, callLogId: log.id }, { headers: cors })
}
