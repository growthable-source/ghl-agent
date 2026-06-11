/**
 * Public agent per-session ops (op=tool | events | end) — mirrors the
 * widget copilot per-session route, keyed by the agent's publicKey.
 * The session must carry the SAME publicKey in its metadata, so a
 * session minted for one agent can't be driven through another's key.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  loadActiveSession,
  runSessionTool,
  recordSessionEvents,
  endCopilotSession,
  type EventBatch,
} from '@/lib/copilot/session-service'

type Params = { params: Promise<{ publicKey: string; sessionId: string }> }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { publicKey, sessionId } = await params
  const op = req.nextUrl.searchParams.get('op')

  if (op === 'end') {
    const row = await db.copilotSession.findUnique({ where: { id: sessionId }, select: { metadata: true } })
    const meta = (row?.metadata ?? {}) as Record<string, unknown>
    if (!row || meta.publicKey !== publicKey) {
      return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS })
    }
    const body = (await req.json().catch(() => ({}))) as { endedReason?: string }
    const result = await endCopilotSession(sessionId, typeof body.endedReason === 'string' ? body.endedReason : 'user_ended')
    return NextResponse.json({ ok: true, durationSecs: result.durationSecs, resolved: result.taskSuccess }, { headers: CORS })
  }

  const loaded = await loadActiveSession(sessionId)
  if (!loaded.ok) {
    const status = loaded.reason === 'not_found' ? 404 : 409
    return NextResponse.json({ error: `Session ${loaded.reason}` }, { status, headers: CORS })
  }
  if (loaded.session.metadata.publicKey !== publicKey) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS })
  }

  if (op === 'tool') {
    const body = (await req.json().catch(() => ({}))) as { name?: string; args?: Record<string, unknown> }
    if (!body.name) return NextResponse.json({ error: 'tool name required' }, { status: 400, headers: CORS })
    const { result, latencyMs } = await runSessionTool(loaded.session, body.name, body.args ?? {})
    return NextResponse.json({ result, latencyMs }, { headers: CORS })
  }
  if (op === 'events') {
    const batch = (await req.json().catch(() => ({}))) as EventBatch
    const counts = await recordSessionEvents(loaded.session, batch)
    return NextResponse.json({ ok: true, ...counts }, { headers: CORS })
  }
  return NextResponse.json({ error: 'unknown op' }, { status: 400, headers: CORS })
}
