import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; userId: string }> }

// DELETE — soft-deactivate a portal user. The session check in
// lib/portal-auth.ts refuses to mint sessions for !isActive users, so
// flipping the flag is enough to lock them out immediately. Hard-delete
// is intentionally not exposed here — the audit trail wants the row.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId, userId } = await params

  const user = await db.portalUser.findUnique({
    where: { id: userId },
    select: { id: true, portalId: true, email: true, isActive: true },
  })
  if (!user || user.portalId !== portalId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  await db.portalUser.update({
    where: { id: userId },
    data: { isActive: false },
  })

  logAdminActionAfter({
    admin: session,
    action: 'deactivate_portal_user',
    target: userId,
    meta: { portalId, email: user.email },
  })

  return NextResponse.json({ ok: true })
}
