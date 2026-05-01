import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { sendPortalInviteEmail } from '@/lib/portal-email'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// 7-day invite window. Long enough to survive a customer's calendar,
// short enough that a leaked link goes stale before it's useful.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// POST — invite a customer to this portal. Generates a random token,
// stores only its sha256, emails the raw token via Resend. The same
// payload also creates the brand-assignment plan that gets materialized
// on accept.
export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId } = await params

  let body: any = {}
  try { body = await req.json() } catch {}

  const email = String(body?.email ?? '').trim().toLowerCase()
  const brandIds: string[] = Array.isArray(body?.brandIds)
    ? body.brandIds.filter((x: unknown) => typeof x === 'string')
    : []

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }
  if (brandIds.length === 0) {
    return NextResponse.json({ error: 'At least one brand assignment required' }, { status: 400 })
  }

  const portal = await db.portal.findUnique({
    where: { id: portalId },
    select: {
      id: true, name: true, primaryColor: true,
      workspace: { select: { brands: { select: { id: true } } } },
    },
  })
  if (!portal) return NextResponse.json({ error: 'Portal not found' }, { status: 404 })

  // Reject brand IDs that don't belong to this portal's workspace.
  // Otherwise an admin (or a forged client request) could grant
  // visibility to a brand outside the portal's scope.
  const validBrandIds = new Set(portal.workspace.brands.map(b => b.id))
  const filtered = brandIds.filter(id => validBrandIds.has(id))
  if (filtered.length === 0) {
    return NextResponse.json({ error: 'No valid brand IDs for this portal' }, { status: 400 })
  }

  // Refuse to re-invite an active user — the operator should manage
  // their brand assignments instead.
  const existingUser = await db.portalUser.findUnique({
    where: { portalId_email: { portalId, email } },
    select: { id: true },
  })
  if (existingUser) {
    return NextResponse.json({ error: 'A user with this email already exists in the portal' }, { status: 409 })
  }

  const rawToken = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS)

  // Upsert: re-inviting the same email replaces the previous pending
  // invite (and rotates the token). The unique key (portalId, email)
  // makes this safe.
  await db.portalInvite.upsert({
    where: { portalId_email: { portalId, email } },
    create: {
      portalId, email, tokenHash, brandIds: filtered,
      invitedBy: session.adminId, expiresAt,
    },
    update: {
      tokenHash, brandIds: filtered, invitedBy: session.adminId,
      expiresAt, acceptedAt: null,
    },
  })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
  const inviteUrl = `${baseUrl}/portal/invite/${rawToken}`

  let emailSent = false
  try {
    await sendPortalInviteEmail({
      to: email,
      portalName: portal.name,
      inviteUrl,
      primaryColor: portal.primaryColor,
    })
    emailSent = !!process.env.RESEND_API_KEY
  } catch (err) {
    console.warn('[PortalInvite] email failed:', err)
  }

  logAdminActionAfter({
    admin: session,
    action: 'invite_portal_user',
    target: portalId,
    meta: { email, brandIds: filtered, emailSent },
  })

  // Return the raw inviteUrl so operators can copy/share it manually
  // when Resend isn't configured (dev / preview environments).
  return NextResponse.json({ ok: true, emailSent, inviteUrl })
}
