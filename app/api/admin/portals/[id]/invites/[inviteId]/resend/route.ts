import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { sendPortalInviteEmail } from '@/lib/portal-email'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; inviteId: string }> }

// Fresh 7-day window on every resend (mirrors the create route).
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// POST — resend a pending invite. Rotates the token (the old email link
// stops working) and restarts the expiry clock, so this also revives
// invites that already expired.
export async function POST(_req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId, inviteId } = await params

  const invite = await db.portalInvite.findUnique({
    where: { id: inviteId },
    select: {
      id: true, portalId: true, email: true, acceptedAt: true,
      portal: { select: { name: true, primaryColor: true } },
    },
  })
  if (!invite || invite.portalId !== portalId) {
    return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  }
  if (invite.acceptedAt) {
    return NextResponse.json({ error: 'Already accepted; manage as user instead' }, { status: 400 })
  }

  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  await db.portalInvite.update({
    where: { id: inviteId },
    data: { tokenHash, expiresAt, invitedBy: session.adminId },
  })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const inviteUrl = `${baseUrl}/portal/invite/${rawToken}`

  let emailSent = false
  try {
    await sendPortalInviteEmail({
      to: invite.email,
      portalName: invite.portal.name,
      inviteUrl,
      primaryColor: invite.portal.primaryColor,
    })
    emailSent = !!process.env.RESEND_API_KEY
  } catch (err) {
    console.warn('[PortalInvite] resend email failed:', err)
  }

  logAdminActionAfter({
    admin: session,
    action: 'resend_portal_invite',
    target: inviteId,
    meta: { portalId, email: invite.email, emailSent },
  })

  // Raw inviteUrl comes back so operators can copy/share it manually
  // when Resend isn't configured (dev / preview environments).
  return NextResponse.json({ ok: true, emailSent, inviteUrl })
}
