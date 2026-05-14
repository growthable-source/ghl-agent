import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

type Params = { params: Promise<{ token: string }> }

/**
 * GET /api/invite/:token
 *
 * Look up an invite by its opaque token so the accept page can show
 * the inviter, workspace, and role before the user commits. Public
 * endpoint — anyone with the link can READ the invite. Acceptance
 * requires a session whose email matches.
 *
 * Returns:
 *   { ok: true, invite: { workspace, role, email, expired, alreadyAccepted } }
 *   { ok: false, error: 'invalid' | 'expired' | 'accepted' }
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params
  if (!token || token.length < 6) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 404 })
  }

  const invite = await db.workspaceInvite.findUnique({
    where: { token },
    select: {
      id: true, email: true, role: true,
      acceptedAt: true, expiresAt: true,
      workspaceId: true,
      workspace: { select: { name: true, logoUrl: true, icon: true } },
      invitedBy: true,
    },
  })
  if (!invite) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 404 })
  }
  if (invite.acceptedAt) {
    return NextResponse.json({ ok: false, error: 'accepted', workspaceId: invite.workspaceId })
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: 'expired' })
  }

  // Inviter display (best-effort — invite still works if user record is gone)
  const inviter = invite.invitedBy
    ? await db.user.findUnique({
        where: { id: invite.invitedBy },
        select: { name: true, email: true },
      }).catch(() => null)
    : null

  // If the requester is already signed in we surface their email so
  // the UI can flag a mismatch BEFORE they hit accept.
  const session = await auth().catch(() => null)
  const sessionEmail = session?.user?.email ?? null

  return NextResponse.json({
    ok: true,
    invite: {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      workspace: {
        id: invite.workspaceId,
        name: invite.workspace?.name ?? null,
        logoUrl: invite.workspace?.logoUrl ?? null,
        icon: invite.workspace?.icon ?? null,
      },
      inviter,
      expiresAt: invite.expiresAt.toISOString(),
    },
    session: { email: sessionEmail },
  })
}
