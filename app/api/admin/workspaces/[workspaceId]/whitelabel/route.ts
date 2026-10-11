import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * Toggle white-label domain access for a workspace. The commercial deal
 * is done outside the product, so this is the "unlock" switch: the
 * workspace always SEES the Custom domain card, but can only add a domain
 * once unlocked. Locking again stops an already-attached domain from being
 * served (it is not removed from Vercel, so re-unlocking restores it).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { workspaceId } = await params
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, whitelabelUnlocked: true },
  })
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const unlocking = !ws.whitelabelUnlocked
  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      whitelabelUnlocked: unlocking,
      whitelabelUnlockedAt: unlocking ? new Date() : null,
      whitelabelUnlockedBy: unlocking ? `admin:${session.email}` : null,
    },
  })

  logAdminActionAfter({
    admin: session,
    action: unlocking ? 'unlock_whitelabel' : 'lock_whitelabel',
    target: workspaceId,
    meta: { name: ws.name },
  })

  return NextResponse.redirect(new URL(`/admin/workspaces/${workspaceId}`, req.url), 303)
}
