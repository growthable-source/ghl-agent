import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { can } from '@/lib/permissions'

type Params = { params: Promise<{ workspaceId: string; inviteId: string }> }

/**
 * DELETE /api/workspaces/:id/invites/:inviteId
 *
 * Cancel a pending invite. Owners and admins only. Once cancelled the
 * row is gone — re-inviting the same email creates a new token.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, inviteId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (!can(access.role, 'members.invite')) {
    return NextResponse.json({ error: 'You do not have permission to cancel invites.' }, { status: 403 })
  }

  const invite = await db.workspaceInvite.findFirst({
    where: { id: inviteId, workspaceId },
    select: { id: true, acceptedAt: true },
  })
  if (!invite) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  // Already-accepted invites are no longer cancellable; the membership
  // they minted lives on and is managed via the members endpoints.
  if (invite.acceptedAt) {
    return NextResponse.json({ error: 'Already accepted — remove the member instead.' }, { status: 409 })
  }

  await db.workspaceInvite.delete({ where: { id: inviteId } })
  return NextResponse.json({ ok: true })
}
