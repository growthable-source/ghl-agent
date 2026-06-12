/**
 * Meeting-bot session ops, keyed by the per-session capability token
 * baked into the bot's webpage URL (op=connect | tool | events | end).
 *
 * The caller is the Recall bot's headless browser loading our
 * /copilot/bot/[botToken] page — same-origin, no NextAuth. The token
 * is the credential: random, single-session, dead once the session
 * ends. Mirrors the public-agent session route's trust model.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  connectMeetingSession,
  findMeetingSessionByToken,
  runSessionTool,
  recordSessionEvents,
  endCopilotSession,
  CopilotNotConfiguredError,
  CopilotSopNotFoundError,
  CopilotTokenMintError,
  type EventBatch,
} from '@/lib/copilot/session-service'

type Params = { params: Promise<{ botToken: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { botToken } = await params
  const op = req.nextUrl.searchParams.get('op')

  if (op === 'connect') {
    try {
      const result = await connectMeetingSession(botToken)
      return NextResponse.json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof CopilotSopNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 })
      }
      if (err instanceof CopilotNotConfiguredError || err instanceof CopilotTokenMintError) {
        return NextResponse.json({ error: 'Live session backend unavailable' }, { status: 503 })
      }
      console.error('[Copilot meeting] connect failed:', err)
      return NextResponse.json({ error: 'connect failed' }, { status: 500 })
    }
  }

  const loaded = await findMeetingSessionByToken(botToken)

  if (op === 'end') {
    // Idempotent — an already-ended/expired session is a no-op success
    // (the page fires this from pagehide and cannot retry).
    if (!loaded.ok) return NextResponse.json({ ok: true, alreadyEnded: true })
    const body = (await req.json().catch(() => ({}))) as { endedReason?: string }
    const result = await endCopilotSession(
      loaded.session.id,
      typeof body.endedReason === 'string' ? body.endedReason.slice(0, 64) : 'meeting_ended',
    )
    return NextResponse.json({ ok: true, durationSecs: result.durationSecs })
  }

  if (!loaded.ok) {
    const status = loaded.reason === 'not_found' ? 404 : 409
    return NextResponse.json({ error: `Session ${loaded.reason}` }, { status })
  }

  if (op === 'tool') {
    const body = (await req.json().catch(() => ({}))) as { name?: string; args?: Record<string, unknown> }
    if (!body.name) return NextResponse.json({ error: 'tool name required' }, { status: 400 })
    const { result, latencyMs } = await runSessionTool(loaded.session, body.name, body.args ?? {})
    return NextResponse.json({ result, latencyMs })
  }
  if (op === 'events') {
    const batch = (await req.json().catch(() => ({}))) as EventBatch
    const counts = await recordSessionEvents(loaded.session, batch)
    return NextResponse.json({ ok: true, ...counts })
  }
  return NextResponse.json({ error: 'unknown op' }, { status: 400 })
}
