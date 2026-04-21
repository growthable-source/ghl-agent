import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Toggle a workspace's paused state. Admin+ can do this; it's an
 * operational lever (stop billing use mid-month, quiet an abusive
 * tenant) so we audit-log it carefully and surface it on the drill-down
 * page's billing section so operators see the last-paused-at timestamp.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const ws = await db.workspace.findUnique({
    where: { id },
    select: { id: true, isPaused: true, name: true },
  })
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const nowPausing = !ws.isPaused
  await db.workspace.update({
    where: { id },
    data: {
      isPaused: nowPausing,
      pausedAt: nowPausing ? new Date() : null,
      pausedBy: nowPausing ? `admin:${session.email}` : null,
    },
  })

  logAdminAction({
    admin: session,
    action: nowPausing ? 'pause_workspace' : 'unpause_workspace',
    target: id,
    meta: { name: ws.name },
  }).catch(() => {})

  return NextResponse.redirect(new URL(`/admin/workspaces/${id}`, _req.url))
}
