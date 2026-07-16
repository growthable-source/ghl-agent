import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET — caller's current availability flag in this workspace.
 * PATCH — toggle it. Body: { isAvailable: boolean }
 *
 * "Available" members are eligible for round-robin / first-available
 * routing; "away" members stay in the workspace but auto-routing
 * skips them. They can still be manually assigned.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const userId = access.session.user!.id

  let row: any = null
  try {
    row = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { isAvailable: true, availabilityChangedAt: true },
    })
  } catch (err: any) {
    // Migration pending — degrade to "available".
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ isAvailable: true, migrationPending: true })
    }
    throw err
  }
  return NextResponse.json({
    isAvailable: row?.isAvailable !== false,
    availabilityChangedAt: row?.availabilityChangedAt?.toISOString() ?? null,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const userId = access.session.user!.id

  let body: any = {}
  try { body = await req.json() } catch {}
  if (typeof body?.isAvailable !== 'boolean') {
    return NextResponse.json({ error: 'isAvailable (boolean) required' }, { status: 400 })
  }

  let memberId: string | null = null
  try {
    // presenceSource 'self' marks this as a deliberate human choice — the
    // auto-away heartbeat never overrides it. Toggling is also activity,
    // so bump lastActivityAt. Both columns ship after the base presence
    // migration, so retry without them on older DBs.
    let updated: { id: string }
    try {
      updated = await db.workspaceMember.update({
        where: { userId_workspaceId: { userId, workspaceId } },
        data: {
          isAvailable: body.isAvailable,
          availabilityChangedAt: new Date(),
          presenceSource: 'self',
          lastActivityAt: new Date(),
        } as any,
        select: { id: true },
      })
    } catch (err: any) {
      if (err?.code !== 'P2022' && !/column .* does not exist/i.test(err?.message ?? '')) throw err
      updated = await db.workspaceMember.update({
        where: { userId_workspaceId: { userId, workspaceId } },
        data: { isAvailable: body.isAvailable, availabilityChangedAt: new Date() },
        select: { id: true },
      })
    }
    memberId = updated.id
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'Migration pending — run prisma/migrations/20260429120000_widget_routing_assignment/migration.sql' }, { status: 503 })
    }
    throw err
  }

  // Append to the presence event log so the agent activity view can
  // reconstruct online/away intervals. Best-effort — a logging blip
  // must not break the toggle. Wrapped in catch for the missing-table
  // case (migration not run yet).
  if (memberId) {
    try {
      await (db as any).memberPresenceEvent.create({
        data: {
          memberId,
          workspaceId,
          state: body.isAvailable ? 'available' : 'away',
          source: 'self',
        },
      })
    } catch (err: any) {
      console.warn('[presence] event log failed:', err?.message)
    }
  }

  // Coming online may free up the queue (a now-available agent can take
  // waiting chats). Best-effort, after the response.
  if (body.isAvailable) {
    after(async () => {
      try {
        const { advanceQueue } = await import('@/lib/widget-routing')
        await advanceQueue(workspaceId)
      } catch (err: any) {
        console.warn('[presence] advanceQueue failed:', err?.message)
      }
    })
  }

  return NextResponse.json({ ok: true, isAvailable: body.isAvailable })
}
