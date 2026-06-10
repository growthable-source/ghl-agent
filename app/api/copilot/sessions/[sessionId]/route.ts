/**
 * GET /api/copilot/sessions/[sessionId]
 *
 * Read a single Co-Pilot session + its transcript + screen events +
 * tool calls. Used by the per-session review surface (P1) and by the
 * live UI while a session is active.
 *
 * App-layer tenancy: we look up the session first, then enforce
 * workspace membership against THAT row's workspaceId. There's no
 * route param for workspaceId because callers don't know it up front
 * (they only have the sessionId from the create response).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import type { CopilotSessionDTO } from '@/lib/copilot/types'

type Params = { params: Promise<{ sessionId: string }> }

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

  const dto: CopilotSessionDTO = {
    id: session.id,
    workspaceId: session.workspaceId,
    channel: session.channel as CopilotSessionDTO['channel'],
    status: session.status as CopilotSessionDTO['status'],
    model: session.model as CopilotSessionDTO['model'],
    roomId: session.roomId,
    locale: session.locale,
    workflowKey: session.workflowKey,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt ? session.endedAt.toISOString() : null,
    durationSecs: session.durationSecs,
    endedReason: session.endedReason,
    toolCallCount: session.toolCallCount,
  }

  return NextResponse.json({
    session: dto,
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
