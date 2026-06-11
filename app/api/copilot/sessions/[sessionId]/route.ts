/**
 * GET  /api/copilot/sessions/[sessionId] — read session + transcript
 *      + screen events + tool calls + analysis. Powers the replay
 *      surface and the live UI.
 *
 * PATCH /api/copilot/sessions/[sessionId] — end the session. The
 *      shared service flips the row, runs the staff workflow-goal
 *      eval, then the Haiku transcript analysis (which auto-opens a
 *      ticket when the issue went unresolved).
 *
 * App-layer tenancy: load the session first, enforce workspace
 * membership against THAT row's workspaceId.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import { endCopilotSession, toCopilotSessionDTO } from '@/lib/copilot/session-service'

type Params = { params: Promise<{ sessionId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { sessionId } = await params

  const session = await db.copilotSession.findUnique({
    where: { id: sessionId },
    select: { id: true, workspaceId: true, status: true },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await requireWorkspaceAccess(session.workspaceId)
  if (access instanceof NextResponse) return access

  const body = (await req.json().catch(() => ({}))) as { endedReason?: string }
  const endedReason = typeof body.endedReason === 'string' ? body.endedReason : 'user_ended'

  const result = await endCopilotSession(sessionId, endedReason)
  return NextResponse.json({
    ok: true,
    alreadyEnded: result.alreadyEnded,
    durationSecs: result.durationSecs,
    taskSuccess: result.taskSuccess,
    analysis: result.analysis,
  })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { sessionId } = await params

  const session = await db.copilotSession.findUnique({
    where: { id: sessionId },
    include: {
      turns: { orderBy: { ts: 'asc' } },
      events: { orderBy: { ts: 'asc' } },
      toolCalls: { orderBy: { ts: 'asc' } },
    },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await requireWorkspaceAccess(session.workspaceId)
  if (access instanceof NextResponse) return access

  const meta = (session.metadata ?? {}) as Record<string, unknown>

  return NextResponse.json({
    session: toCopilotSessionDTO(session),
    mode: meta.mode === 'widget' ? 'widget' : 'staff',
    analysis: meta.analysis ?? null,
    ticket: meta.ticket ?? null,
    turns: session.turns.map(t => ({
      id: t.id,
      role: t.role,
      text: t.text,
      tokens: t.tokens,
      ts: t.ts.toISOString(),
    })),
    events: session.events.map(e => ({
      id: e.id,
      visionSummary: e.visionSummary,
      detectedContext: e.detectedContext,
      ts: e.ts.toISOString(),
    })),
    toolCalls: session.toolCalls.map(c => ({
      id: c.id,
      toolName: c.toolName,
      args: c.args,
      resultSummary: c.resultSummary,
      isWrite: c.isWrite,
      confirmedBy: c.confirmedBy,
      latencyMs: c.latencyMs,
      ts: c.ts.toISOString(),
    })),
  })
}
