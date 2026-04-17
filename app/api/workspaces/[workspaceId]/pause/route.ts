import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { audit } from '@/lib/audit'
import { notify } from '@/lib/notifications'
import { fireWebhook } from '@/lib/webhooks'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET /api/workspaces/:workspaceId/pause — read pause state
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { isPaused: true, pausedAt: true, pausedBy: true },
    })
    return NextResponse.json(ws ?? { isPaused: false, pausedAt: null, pausedBy: null })
  } catch {
    // Columns may not exist yet if migration hasn't run
    return NextResponse.json({ isPaused: false, pausedAt: null, pausedBy: null })
  }
}

/**
 * POST /api/workspaces/:workspaceId/pause — pause or resume the workspace
 * Body: { paused: boolean }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: { paused?: boolean } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const paused = body.paused === true

  try {
    const ws = await db.workspace.update({
      where: { id: workspaceId },
      data: {
        isPaused: paused,
        pausedAt: paused ? new Date() : null,
        pausedBy: paused ? access.session.user.id : null,
      },
      select: { isPaused: true, pausedAt: true, pausedBy: true },
    })

    // Audit + notify + webhook
    audit({
      workspaceId,
      actorId: access.session.user.id,
      action: paused ? 'workspace.pause' : 'workspace.resume',
      targetType: 'workspace',
      targetId: workspaceId,
    }).catch(() => {})

    notify({
      workspaceId,
      event: paused ? 'pause_activated' : 'pause_deactivated',
      title: paused ? 'All agents paused' : 'Agents resumed',
      body: paused ? 'No new messages will be sent until resumed.' : 'Agents are now replying again.',
      severity: paused ? 'warning' : 'info',
    }).catch(() => {})

    fireWebhook({
      workspaceId,
      event: paused ? 'agent.paused' : 'agent.resumed',
      payload: { scope: 'workspace', pausedBy: access.session.user.id },
    }).catch(() => {})

    return NextResponse.json(ws)
  } catch (err: any) {
    console.error('[Pause] Failed:', err.message)
    return NextResponse.json({ error: 'Failed to update pause state' }, { status: 500 })
  }
}
