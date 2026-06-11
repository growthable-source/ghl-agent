/**
 * Widget-surface per-session Co-Pilot endpoints, multiplexed on one
 * route file (visitor auth = widget publicKey + the session's own
 * widgetId binding — a session minted for widget A can never be
 * driven through widget B's key):
 *
 *   POST  ?op=tool   { name, args }   → execute read-only tool
 *   POST  ?op=events { turns, ... }   → batched event sink
 *   POST  ?op=end    { endedReason }  → end + Haiku analysis + ticket
 *
 * One file instead of three because the auth preamble is identical
 * and the widget surface (public internet) benefits from the
 * smallest possible route count to reason about.
 */

import { NextRequest, NextResponse } from 'next/server'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import {
  loadActiveSession,
  runSessionTool,
  recordSessionEvents,
  endCopilotSession,
  type EventBatch,
} from '@/lib/copilot/session-service'

type Params = { params: Promise<{ widgetId: string; sessionId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId, sessionId } = await params
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  const v = await validateWidgetRequest(req, widgetId)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  const op = req.nextUrl.searchParams.get('op')

  // End must work on sessions in any state (idempotent) and doesn't
  // need the liveness gate — handle before loadActiveSession.
  if (op === 'end') {
    const body = (await req.json().catch(() => ({}))) as { endedReason?: string }
    // Verify binding without requiring 'active'.
    const { db } = await import('@/lib/db')
    const row = await db.copilotSession.findUnique({
      where: { id: sessionId },
      select: { metadata: true },
    })
    const meta = (row?.metadata ?? {}) as Record<string, unknown>
    if (!row || meta.widgetId !== widgetId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers })
    }
    const result = await endCopilotSession(
      sessionId,
      typeof body.endedReason === 'string' ? body.endedReason : 'user_ended',
    )
    // Visitors get the resolution state but NOT the internal analysis
    // payload (summary/sentiment is operator-facing).
    return NextResponse.json(
      { ok: true, durationSecs: result.durationSecs, resolved: result.taskSuccess },
      { headers },
    )
  }

  const loaded = await loadActiveSession(sessionId)
  if (!loaded.ok) {
    const status = loaded.reason === 'not_found' ? 404 : 409
    return NextResponse.json({ error: `Session ${loaded.reason}` }, { status, headers })
  }
  if (loaded.session.metadata.widgetId !== widgetId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers })
  }

  if (op === 'tool') {
    const body = (await req.json().catch(() => ({}))) as { name?: string; args?: Record<string, unknown> }
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'tool name required' }, { status: 400, headers })
    }
    const { result, latencyMs } = await runSessionTool(
      loaded.session,
      body.name,
      body.args && typeof body.args === 'object' ? body.args : {},
    )
    return NextResponse.json({ result, latencyMs }, { headers })
  }

  if (op === 'events') {
    const batch = (await req.json().catch(() => ({}))) as EventBatch
    const counts = await recordSessionEvents(loaded.session, batch)
    return NextResponse.json({ ok: true, ...counts }, { headers })
  }

  return NextResponse.json({ error: 'unknown op' }, { status: 400, headers })
}
