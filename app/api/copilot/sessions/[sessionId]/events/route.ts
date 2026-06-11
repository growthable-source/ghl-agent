/**
 * POST /api/copilot/sessions/[sessionId]/events — staff surface.
 *
 * Batched event sink (transcript turns, screen-event summaries, cost
 * counter deltas). No field accepts raw frames (§11). Mechanics in
 * the shared session service.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { loadActiveSession, recordSessionEvents, type EventBatch } from '@/lib/copilot/session-service'

type Params = { params: Promise<{ sessionId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { sessionId } = await params
  const loaded = await loadActiveSession(sessionId)
  if (!loaded.ok) {
    const status = loaded.reason === 'not_found' ? 404 : 409
    return NextResponse.json({ error: `Session ${loaded.reason}` }, { status })
  }

  const access = await requireWorkspaceAccess(loaded.session.workspaceId)
  if (access instanceof NextResponse) return access

  const batch = (await req.json().catch(() => ({}))) as EventBatch
  const counts = await recordSessionEvents(loaded.session, batch)
  return NextResponse.json({ ok: true, ...counts })
}
