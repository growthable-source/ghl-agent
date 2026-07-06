import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; userId: string }> }

// PATCH — flip a portal user's isActive flag (deactivate / reactivate).
// The session check in lib/portal-auth.ts refuses to mint sessions for
// !isActive users, so flipping the flag locks them out (or lets them
// back in) immediately. Existing sessions of a deactivated user die on
// the next request's session check.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId, userId } = await params

  let body: any = {}
  try { body = await req.json() } catch {}
  if (typeof body?.isActive !== 'boolean') {
    return NextResponse.json({ error: 'isActive boolean required' }, { status: 400 })
  }

  const user = await db.portalUser.findUnique({
    where: { id: userId },
    select: { id: true, portalId: true, email: true, isActive: true },
  })
  if (!user || user.portalId !== portalId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  await db.portalUser.update({
    where: { id: userId },
    data: { isActive: body.isActive },
  })

  logAdminActionAfter({
    admin: session,
    action: body.isActive ? 'reactivate_portal_user' : 'deactivate_portal_user',
    target: userId,
    meta: { portalId, email: user.email },
  })

  return NextResponse.json({ ok: true })
}

// DELETE — permanently remove a portal user. Brand assignments cascade,
// ticket-draft reviews null out their reviewer. The admin action log
// keeps the who/when record, and removal frees the email for a fresh
// invite (the invite route refuses emails with an existing user row).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId, userId } = await params

  const user = await db.portalUser.findUnique({
    where: { id: userId },
    select: { id: true, portalId: true, email: true },
  })
  if (!user || user.portalId !== portalId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Drop the consumed invite row too — otherwise the stale accepted
  // invite lingers in the table and confuses a later re-invite.
  await db.$transaction([
    db.portalUser.delete({ where: { id: userId } }),
    db.portalInvite.deleteMany({ where: { portalId, email: user.email } }),
  ])

  logAdminActionAfter({
    admin: session,
    action: 'remove_portal_user',
    target: userId,
    meta: { portalId, email: user.email },
  })

  return NextResponse.json({ ok: true })
}
