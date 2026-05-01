import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; inviteId: string }> }

// DELETE — revoke a pending invite. Hard delete (the email link stops
// working immediately). Already-accepted invites are not deletable
// here — manage the user via the user routes instead.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId, inviteId } = await params

  const invite = await db.portalInvite.findUnique({
    where: { id: inviteId },
    select: { id: true, portalId: true, acceptedAt: true, email: true },
  })
  if (!invite || invite.portalId !== portalId) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }
  if (invite.acceptedAt) {
    return NextResponse.json({ error: 'Already accepted; manage as user instead' }, { status: 400 })
  }

  await db.portalInvite.delete({ where: { id: inviteId } })
  logAdminActionAfter({
    admin: session,
    action: 'revoke_portal_invite',
    target: inviteId,
    meta: { portalId, email: invite.email },
  })
  return NextResponse.json({ ok: true })
}
