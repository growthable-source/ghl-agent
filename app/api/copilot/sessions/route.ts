/**
 * Real-time Co-Pilot — session lifecycle.
 *
 * v0 PR 1 (foundation): POST creates a CopilotSession row + STUBS the
 * realtime-transport token. There's no LiveKit integration yet — the
 * token is the literal string 'TODO_LIVEKIT' so the UI can wire up
 * the request flow end-to-end before the next PR plugs in
 * `lib/copilot/transport/livekit.ts`. The client surface assumes
 * this and gates the "Start session" affordance off until a real
 * token comes back.
 *
 * Access control:
 *   - workspace membership (handled by requireWorkspaceAccess)
 *   - copilot plan gate (lib/plans.ts:canUseCopilot — Scale tier OR
 *     workspace listed in COPILOT_WORKSPACE_ALLOWLIST)
 *
 * Note: workspaceId is supplied in the request body, not in a route
 * param. This route is per-user, not per-workspace, because the UI
 * picks the workspace at session-create time (the Co-Pilot sidebar
 * entry sits inside a workspace, so the body always carries the id
 * of the workspace the user is currently in).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'
import { canUseCopilot } from '@/lib/plans'
import type { CreateCopilotSessionInput, CopilotSessionDTO } from '@/lib/copilot/types'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { workspaceId?: string } & CreateCopilotSessionInput
  const workspaceId = body.workspaceId

  if (!workspaceId || typeof workspaceId !== 'string') {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Plan gate. Load the workspace plan once and pass through the
  // shared helper so dogfood allowlist + Scale-tier semantics stay in
  // one place. Workspace must exist by this point — requireWorkspace-
  // Access only returned ok because membership was confirmed.
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

  // Validate the (small) shape we accept from the client.
  const channel = body.channel === 'recall_meeting_bot' ? 'recall_meeting_bot' : 'in_app_webrtc'
  const locale = typeof body.locale === 'string' && body.locale.length <= 16 ? body.locale : 'en-AU'
  const workflowKey = typeof body.workflowKey === 'string' ? body.workflowKey.slice(0, 64) : null

  const created = await db.copilotSession.create({
    data: {
      workspaceId,
      startedByUserId: access.session.user.id,
      channel,
      locale,
      workflowKey,
      // model populated by the orchestrator once a RealtimeModelProvider
      // accepts the session. Stays NULL until then.
    },
  })

  const dto: CopilotSessionDTO = {
    id: created.id,
    workspaceId: created.workspaceId,
    channel: created.channel as CopilotSessionDTO['channel'],
    status: created.status as CopilotSessionDTO['status'],
    model: created.model as CopilotSessionDTO['model'],
    roomId: created.roomId,
    locale: created.locale,
    workflowKey: created.workflowKey,
    startedAt: created.startedAt.toISOString(),
    endedAt: created.endedAt ? created.endedAt.toISOString() : null,
    durationSecs: created.durationSecs,
    endedReason: created.endedReason,
    toolCallCount: created.toolCallCount,
  }

  // TODO_LIVEKIT — replace with a signed LiveKit room token once the
  // transport lib lands (next PR). UI keeps "Start session" disabled
  // while this stays TODO so we don't ship a button that does nothing.
  return NextResponse.json({ session: dto, token: 'TODO_LIVEKIT' })
}
