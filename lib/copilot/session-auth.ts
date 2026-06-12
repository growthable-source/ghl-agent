/**
 * Shared auth + liveness check for the per-session Co-Pilot routes
 * (tool exec, event sink, end). App-layer tenancy: load the session
 * row first, then enforce workspace membership against THAT row's
 * workspaceId — callers only know the sessionId.
 *
 * Also enforces the max-duration ceiling server-side (P0-11): the
 * client runs a countdown timer, but a wedged client must not keep
 * an expired session writable. Past the ceiling we flip the row to
 * ended and reject the write with 409.
 */

import { NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import { COPILOT_DEFAULTS } from './config'

export interface ActiveCopilotSession {
  id: string
  workspaceId: string
  workflowKey: string | null
  startedAt: Date
  status: string
}

export async function requireActiveCopilotSession(
  sessionId: string,
): Promise<ActiveCopilotSession | NextResponse> {
  const session = await db.copilotSession.findUnique({
    where: { id: sessionId },
    select: { id: true, workspaceId: true, workflowKey: true, startedAt: true, status: true },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await requireWorkspaceAccess(session.workspaceId)
  if (access instanceof NextResponse) return access

  if (session.status !== 'active') {
    return NextResponse.json({ error: 'Session is no longer active', code: 'SESSION_ENDED' }, { status: 409 })
  }

  const ageSecs = (Date.now() - session.startedAt.getTime()) / 1000
  if (ageSecs > COPILOT_DEFAULTS.maxSessionSecs) {
    await db.copilotSession.update({
      where: { id: session.id },
      data: {
        status: 'ended',
        endedAt: new Date(),
        endedReason: 'max_duration',
        durationSecs: Math.round(ageSecs),
      },
    })
    return NextResponse.json({ error: 'Session exceeded the maximum duration', code: 'SESSION_EXPIRED' }, { status: 409 })
  }

  return session
}
