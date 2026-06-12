/**
 * Send a Co-Pilot agent to a live meeting (Zoom / Google Meet / Teams).
 *
 *   POST   { meetingUrl }  — dispatch a Recall bot running this agent
 *   GET    ?sessionId=     — bot + session status for the UI poll
 *   DELETE ?sessionId=     — pull the bot out of the call + end session
 *
 * Staff-auth (workspace membership), same as every other agent route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import {
  createMeetingSession,
  endCopilotSession,
  CopilotNotConfiguredError,
  CopilotSopNotFoundError,
} from '@/lib/copilot/session-service'
import { getMeetingBot, removeMeetingBot, describeBotStatus, RecallApiError } from '@/lib/copilot/recall'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = (await req.json().catch(() => ({}))) as { meetingUrl?: string }
  if (!body.meetingUrl || typeof body.meetingUrl !== 'string') {
    return NextResponse.json({ error: 'meetingUrl required' }, { status: 400 })
  }

  try {
    const { session, bot } = await createMeetingSession({
      workspaceId,
      userId: access.session.user.id,
      agentId,
      meetingUrl: body.meetingUrl.trim(),
    })
    return NextResponse.json({
      ok: true,
      sessionId: session.id,
      botId: bot.id,
      status: bot.status,
      statusLabel: describeBotStatus(bot.status),
    })
  } catch (err) {
    if (err instanceof CopilotNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 })
    }
    if (err instanceof CopilotSopNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof RecallApiError) {
      console.error('[Copilot meeting] recall error:', err)
      return NextResponse.json({ error: `The meeting bot service rejected the request: ${err.message}` }, { status: 502 })
    }
    console.error('[Copilot meeting] dispatch failed:', err)
    return NextResponse.json({ error: 'Could not send the agent to the meeting' }, { status: 500 })
  }
}

/** Load + authorize a meeting session row for GET/DELETE. */
async function loadOwnedSession(workspaceId: string, agentId: string, sessionId: string | null) {
  if (!sessionId) return null
  const row = await db.copilotSession.findFirst({
    where: { id: sessionId, workspaceId, channel: 'recall_meeting_bot' },
    select: { id: true, status: true, endedReason: true, durationSecs: true, roomId: true, metadata: true },
  })
  if (!row) return null
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  if (meta.copilotAgentId !== agentId) return null
  return row
}

export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const row = await loadOwnedSession(workspaceId, agentId, req.nextUrl.searchParams.get('sessionId'))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let botStatus: string | null = null
  if (row.roomId) {
    try {
      botStatus = (await getMeetingBot(row.roomId)).status
    } catch (err) {
      console.warn('[Copilot meeting] bot status fetch failed:', err)
    }
  }

  // The bot leaving the call is the authoritative end signal when the
  // page's own beacon didn't land (killed browser, network blip).
  if (row.status === 'active' && (botStatus === 'done' || botStatus === 'call_ended' || botStatus === 'fatal')) {
    await endCopilotSession(row.id, botStatus === 'fatal' ? 'bot_failed' : 'meeting_ended')
    row.status = 'ended'
  }

  return NextResponse.json({
    sessionStatus: row.status,
    endedReason: row.endedReason,
    durationSecs: row.durationSecs,
    botStatus,
    statusLabel:
      row.status !== 'active'
        ? 'Session ended'
        : describeBotStatus(botStatus),
  })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const row = await loadOwnedSession(workspaceId, agentId, req.nextUrl.searchParams.get('sessionId'))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (row.roomId) await removeMeetingBot(row.roomId)
  const result = await endCopilotSession(row.id, 'removed_by_staff')
  return NextResponse.json({ ok: true, durationSecs: result.durationSecs })
}
