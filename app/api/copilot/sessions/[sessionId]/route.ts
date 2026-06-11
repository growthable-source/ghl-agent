/**
 * GET  /api/copilot/sessions/[sessionId] — read session + transcript
 *      + screen events + tool calls. Used by the per-session review
 *      surface (P1) and by the live UI while a session is active.
 *
 * PATCH /api/copilot/sessions/[sessionId] — end the session. Flips
 *      status, computes duration, and writes the auto task_success
 *      eval record (P0-10): we re-read the workspace setup state and
 *      check it against the workflow's goal predicate — no manual
 *      labeling needed for this signal.
 *
 * App-layer tenancy: we look up the session first, then enforce
 * workspace membership against THAT row's workspaceId. There's no
 * route param for workspaceId because callers don't know it up front
 * (they only have the sessionId from the create response).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import { getWorkspaceSetupState } from '@/lib/copilot/setup-state'
import { getWorkflow } from '@/lib/copilot/workflows'
import type { CopilotSessionDTO } from '@/lib/copilot/types'

type Params = { params: Promise<{ sessionId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { sessionId } = await params

  const session = await db.copilotSession.findUnique({
    where: { id: sessionId },
    select: { id: true, workspaceId: true, workflowKey: true, startedAt: true, status: true },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const access = await requireWorkspaceAccess(session.workspaceId)
  if (access instanceof NextResponse) return access

  if (session.status !== 'active') {
    // Idempotent: ending an ended session is a no-op, not an error —
    // the client may race its timer against a sendBeacon flush.
    return NextResponse.json({ ok: true, alreadyEnded: true })
  }

  const body = (await req.json().catch(() => ({}))) as { endedReason?: string }
  const endedReason =
    typeof body.endedReason === 'string' ? body.endedReason.slice(0, 64) : 'user_ended'

  const endedAt = new Date()
  const durationSecs = Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000)

  await db.copilotSession.update({
    where: { id: session.id },
    data: { status: 'ended', endedAt, durationSecs, endedReason },
  })

  // Auto task_success eval (P0-10): did the workspace reach the
  // workflow's goal state by session end? Best-effort — an eval write
  // failure must not fail the session end.
  let taskSuccess: boolean | null = null
  try {
    const state = await getWorkspaceSetupState(session.workspaceId)
    const workflow = getWorkflow(session.workflowKey)
    taskSuccess = workflow.goalReached(state)
    await db.copilotEvalRecord.create({
      data: {
        sessionId: session.id,
        workspaceId: session.workspaceId,
        scope: 'session',
        taskSuccess,
        notes: `auto: workflow=${workflow.key} goal ${taskSuccess ? 'reached' : 'not reached'} at session end`,
      },
    })
  } catch (err) {
    console.error('[Copilot] auto eval failed:', err)
  }

  return NextResponse.json({ ok: true, durationSecs, taskSuccess })
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
