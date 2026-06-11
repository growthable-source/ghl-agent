/**
 * Staff/dashboard Co-Pilot session endpoints.
 *
 * POST — create a session + mint the ephemeral realtime token.
 *        Auth: workspace membership + copilot plan gate. All session
 *        mechanics live in lib/copilot/session-service (shared with
 *        the widget surface).
 * GET  — session history for a workspace (?workspaceId=), newest
 *        first, with the Haiku analysis summary for the list UI.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import { canUseCopilot } from '@/lib/plans'
import {
  createStaffSession,
  toCopilotSessionDTO,
  CopilotNotConfiguredError,
  CopilotTokenMintError,
  CopilotSopNotFoundError,
} from '@/lib/copilot/session-service'
import type { CreateCopilotSessionInput } from '@/lib/copilot/types'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { workspaceId?: string } & CreateCopilotSessionInput
  const workspaceId = body.workspaceId
  if (!workspaceId || typeof workspaceId !== 'string') {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true },
  })
  if (!workspace) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  if (!canUseCopilot(workspace.plan, workspaceId)) {
    return NextResponse.json(
      { error: 'Co-Pilot is not available on your current plan.', code: 'COPILOT_PLAN_GATE' },
      { status: 402 },
    )
  }

  try {
    const extra = body as unknown as { mode?: 'onboarding' | 'general' | 'sop'; sopId?: string }
    const result = await createStaffSession({
      workspaceId,
      userId: access.session.user.id,
      locale: body.locale,
      workflowKey: body.workflowKey,
      mode: extra.mode,
      sopId: extra.sopId ?? null,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CopilotNotConfiguredError) {
      return NextResponse.json(
        { error: 'Co-Pilot is not configured on this deployment (missing realtime model credentials).', code: 'COPILOT_NOT_CONFIGURED' },
        { status: 503 },
      )
    }
    if (err instanceof CopilotSopNotFoundError) {
      return NextResponse.json({ error: 'That procedure no longer exists.', code: 'SOP_NOT_FOUND' }, { status: 404 })
    }
    if (err instanceof CopilotTokenMintError) {
      return NextResponse.json(
        { error: 'Could not start a realtime session — the model provider rejected the request.', code: 'COPILOT_TOKEN_MINT_FAILED' },
        { status: 502 },
      )
    }
    throw err
  }
}

export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const rows = await db.copilotSession.findMany({
    where: { workspaceId },
    orderBy: { startedAt: 'desc' },
    take: 50,
  })

  return NextResponse.json({
    sessions: rows.map(row => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>
      const analysis = (meta.analysis ?? null) as Record<string, unknown> | null
      const ticket = (meta.ticket ?? null) as Record<string, unknown> | null
      return {
        ...toCopilotSessionDTO(row),
        mode: meta.mode === 'widget' ? 'widget' : 'staff',
        summary: analysis && typeof analysis.summary === 'string' ? analysis.summary : null,
        issueResolved:
          analysis && typeof analysis.issueResolved === 'boolean' ? analysis.issueResolved : null,
        sentiment: analysis && typeof analysis.sentiment === 'string' ? analysis.sentiment : null,
        ticketNumber: ticket && typeof ticket.ticketNumber === 'number' ? ticket.ticketNumber : null,
      }
    }),
  })
}
