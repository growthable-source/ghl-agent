import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

type Params = { params: Promise<{ token: string }> }

/**
 * POST /api/invite/:token/accept
 *
 * Sign-in is required. The accepting user's email must match the
 * invite's email (case-insensitive) — prevents someone with a leaked
 * link from joining as themselves. On success we:
 *   - Stamp the invite as accepted (preserve audit trail)
 *   - Create the WorkspaceMember with the invite's role
 *
 * Idempotent — re-accepting a still-pending invite for an existing
 * member is a no-op success. Tombstoned invites (acceptedAt set) hard
 * 409 so a recycled link can't sneak someone back in after they were
 * removed.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { token } = await params
  const session = await auth()
  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ ok: false, error: 'not_signed_in' }, { status: 401 })
  }

  const invite = await db.workspaceInvite.findUnique({
    where: { token },
    select: {
      id: true, workspaceId: true, email: true, role: true,
      acceptedAt: true, expiresAt: true,
    },
  })
  if (!invite) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 404 })
  }
  if (invite.acceptedAt) {
    return NextResponse.json({ ok: false, error: 'accepted' }, { status: 409 })
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ ok: false, error: 'expired' }, { status: 410 })
  }

  // Case-insensitive email match. Sessions can vary in case
  // depending on the OAuth provider; the invite stores lower-cased
  // by the POST endpoint.
  const userEmail = (session.user.email || '').toLowerCase()
  if (userEmail !== invite.email.toLowerCase()) {
    return NextResponse.json({
      ok: false,
      error: 'email_mismatch',
      expectedEmail: invite.email,
      sessionEmail: session.user.email,
    }, { status: 403 })
  }

  // Already a member? Mark the invite accepted and report success so
  // the UI can route them straight to the workspace.
  const existing = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: invite.workspaceId } },
    select: { id: true, role: true },
  })

  if (existing) {
    await db.workspaceInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    })
    return NextResponse.json({
      ok: true,
      workspaceId: invite.workspaceId,
      alreadyMember: true,
      role: existing.role,
    })
  }

  // Create membership + tombstone invite atomically so a partial
  // failure doesn't leave them half-joined.
  await db.$transaction([
    db.workspaceMember.create({
      data: {
        userId: session.user.id,
        workspaceId: invite.workspaceId,
        role: invite.role,
      },
    }),
    db.workspaceInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    }),
  ])

  return NextResponse.json({
    ok: true,
    workspaceId: invite.workspaceId,
    role: invite.role,
  })
}
