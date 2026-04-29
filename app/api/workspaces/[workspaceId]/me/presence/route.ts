import { NextRequest, NextResponse } from 'next/server'
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

  try {
    await db.workspaceMember.update({
      where: { userId_workspaceId: { userId, workspaceId } },
      data: { isAvailable: body.isAvailable, availabilityChangedAt: new Date() },
    })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'Migration pending — run prisma/migrations/20260429120000_widget_routing_assignment/migration.sql' }, { status: 503 })
    }
    throw err
  }
  return NextResponse.json({ ok: true, isAvailable: body.isAvailable })
}
