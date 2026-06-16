/**
 * Public "Try Now" demo — send the published demo agent into a visitor's
 * meeting (Google Meet / Zoom / Teams) for a capped 10 minutes.
 *
 * Auth = the agent's publicKey (same trust model as the screen-share
 * launch). Unauthenticated + spends Recall minutes, so dispatch is
 * concurrency-capped + per-IP cooldowned in createPublicMeetingSession,
 * and the copilot-demo-reaper cron is the authoritative time kill.
 *
 *   POST   { meetingUrl }    — dispatch the demo bot
 *   GET    ?sessionId=       — bot/session status + remaining seconds (poll)
 *   DELETE ?sessionId=       — visitor ends the demo early
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createPublicMeetingSession,
  endCopilotSession,
  DEMO_MAX_SECS,
  CopilotNotConfiguredError,
  CopilotSopNotFoundError,
  CopilotDemoLimitError,
} from '@/lib/copilot/session-service'
import { getMeetingBot, removeMeetingBot, describeBotStatus, RecallApiError } from '@/lib/copilot/recall'

type Params = { params: Promise<{ publicKey: string }> }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim() || null
  return req.headers.get('x-real-ip')
}

/**
 * Soft origin lock. When COPILOT_DEMO_ALLOWED_ORIGINS is set (comma-separated
 * list of origins, e.g. "https://voxility.ai,https://www.voxility.ai"), only
 * those origins may launch a demo. Unset = allow any (lets the website team
 * test before the env is configured). Browser-only deterrent — the real cost
 * ceiling is the concurrency cap + per-IP cooldown in the session service.
 */
function originAllowed(req: NextRequest): boolean {
  const allow = (process.env.COPILOT_DEMO_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
  if (allow.length === 0) return true
  const origin = req.headers.get('origin')
  return !!origin && allow.includes(origin)
}

/** Only ever expose demo meeting sessions to the public poll/end routes. */
async function loadDemoSession(sessionId: string | null) {
  if (!sessionId) return null
  return db.copilotSession.findFirst({
    where: { id: sessionId, channel: 'recall_meeting_bot', metadata: { path: ['demo'], equals: true } },
    select: { id: true, status: true, roomId: true, startedAt: true },
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { publicKey } = await params
  if (!originAllowed(req)) {
    return NextResponse.json({ error: 'This demo can only be launched from the official site.' }, { status: 403, headers: CORS })
  }
  const body = (await req.json().catch(() => ({}))) as { meetingUrl?: string; locale?: string }
  if (!body.meetingUrl || typeof body.meetingUrl !== 'string') {
    return NextResponse.json({ error: 'meetingUrl required' }, { status: 400, headers: CORS })
  }

  try {
    const result = await createPublicMeetingSession(publicKey, {
      meetingUrl: body.meetingUrl.trim(),
      ip: clientIp(req),
      locale: body.locale,
    })
    return NextResponse.json(
      {
        ok: true,
        sessionId: result.sessionId,
        status: result.status,
        statusLabel: describeBotStatus(result.status),
        durationCapSecs: DEMO_MAX_SECS,
      },
      { headers: CORS },
    )
  } catch (err) {
    if (err instanceof CopilotDemoLimitError) {
      return NextResponse.json({ error: err.message, reason: err.kind }, { status: 429, headers: CORS })
    }
    if (err instanceof CopilotSopNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: CORS })
    }
    if (err instanceof CopilotNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503, headers: CORS })
    }
    if (err instanceof RecallApiError) {
      console.error('[Copilot demo] recall error:', err)
      return NextResponse.json({ error: 'The meeting bot service rejected the request.' }, { status: 502, headers: CORS })
    }
    console.error('[Copilot demo] dispatch failed:', err)
    return NextResponse.json({ error: 'Could not start the demo right now.' }, { status: 500, headers: CORS })
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  await params
  const row = await loadDemoSession(req.nextUrl.searchParams.get('sessionId'))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS })

  let botStatus: string | null = null
  if (row.roomId) {
    try {
      botStatus = (await getMeetingBot(row.roomId)).status
    } catch (err) {
      console.warn('[Copilot demo] bot status fetch failed:', err)
    }
  }

  // The bot leaving is the authoritative end signal if the visitor's tab died.
  if (row.status === 'active' && (botStatus === 'done' || botStatus === 'call_ended' || botStatus === 'fatal')) {
    await endCopilotSession(row.id, botStatus === 'fatal' ? 'bot_failed' : 'meeting_ended')
    row.status = 'ended'
  }

  const remainingSecs = Math.max(0, DEMO_MAX_SECS - Math.round((Date.now() - row.startedAt.getTime()) / 1000))
  return NextResponse.json(
    {
      sessionStatus: row.status,
      botStatus,
      statusLabel: row.status !== 'active' ? 'Demo ended' : describeBotStatus(botStatus),
      remainingSecs: row.status === 'active' ? remainingSecs : 0,
    },
    { headers: CORS },
  )
}

export async function DELETE(req: NextRequest, { params }: Params) {
  await params
  const row = await loadDemoSession(req.nextUrl.searchParams.get('sessionId'))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: CORS })

  if (row.roomId) await removeMeetingBot(row.roomId)
  const result = await endCopilotSession(row.id, 'demo_ended_by_visitor')
  return NextResponse.json({ ok: true, durationSecs: result.durationSecs }, { headers: CORS })
}
