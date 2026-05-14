import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { can } from '@/lib/permissions'
import { sendWorkspaceInviteEmail } from '@/lib/workspace-invite-email'

type Params = { params: Promise<{ workspaceId: string; inviteId: string }> }

/**
 * POST /api/workspaces/:id/invites/:inviteId/resend
 *
 * Re-issue an invite — rotates the token (old links stop working),
 * extends the expiry by 7 days from now, and re-sends the email.
 * Use this for "I never got it / it's about to expire."
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, inviteId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (!can(access.role, 'members.invite')) {
    return NextResponse.json({ error: 'You do not have permission to resend invites.' }, { status: 403 })
  }

  const invite = await db.workspaceInvite.findFirst({
    where: { id: inviteId, workspaceId, acceptedAt: null },
  })
  if (!invite) {
    return NextResponse.json({ error: 'Pending invite not found' }, { status: 404 })
  }

  const newToken = randomBytes(24).toString('base64url')
  const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await db.workspaceInvite.update({
    where: { id: inviteId },
    data: {
      token: newToken,
      expiresAt: newExpiry,
      invitedBy: access.session.user.id,
    },
  })

  try {
    const inviter = await db.user.findUnique({
      where: { id: access.session.user.id },
      select: { name: true, email: true },
    }).catch(() => null)
    const ws = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true },
    })
    const base = process.env.NEXT_PUBLIC_APP_URL || ''
    await sendWorkspaceInviteEmail({
      to: invite.email,
      workspaceName: ws?.name || 'a Voxility workspace',
      inviterName: inviter?.name ?? inviter?.email ?? null,
      role: invite.role,
      inviteUrl: `${base}/invite/${newToken}`,
    })
  } catch (err: any) {
    console.warn('[invites] resend email failed for', invite.email, err?.message)
  }

  return NextResponse.json({ ok: true, expiresAt: newExpiry })
}
