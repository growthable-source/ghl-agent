import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import {
  hashPortalPassword,
  signPortalToken,
  setPortalCookie,
} from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ token: string }> }

// POST /api/portal/invite/[token]/accept
//
// Looks up the pending invite by sha256(token), creates (or activates)
// the PortalUser, materializes the brand assignments captured at invite
// time, marks the invite accepted, and signs the user in. All inside a
// single transaction so a half-applied accept never leaves a user with
// a password but no brand assignments (or vice versa).
export async function POST(req: NextRequest, { params }: Ctx) {
  const { token } = await params
  let body: any = {}
  try { body = await req.json() } catch {}
  const password = String(body?.password ?? '')
  const name = body?.name ? String(body.name).trim() || null : null

  if (password.length < 10) {
    return NextResponse.json({ error: 'Password must be at least 10 characters' }, { status: 400 })
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')

  const invite = await db.portalInvite.findUnique({
    where: { tokenHash },
    select: {
      id: true, portalId: true, email: true, brandIds: true,
      acceptedAt: true, expiresAt: true,
      portal: { select: { isActive: true, portalBrands: { select: { brandId: true } } } },
    },
  })
  if (!invite) {
    return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 })
  }
  if (invite.acceptedAt) {
    return NextResponse.json({ error: 'This invitation has already been accepted' }, { status: 400 })
  }
  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: 'This invitation has expired' }, { status: 400 })
  }
  if (!invite.portal.isActive) {
    return NextResponse.json({ error: 'This portal is disabled' }, { status: 400 })
  }

  // Validate the invite's stored brand IDs against the portal's current
  // catalog — a brand the admin selected at invite time may have been
  // removed from the portal before the user accepted. Drop the dead ones.
  const validBrandIds = new Set(invite.portal.portalBrands.map(pb => pb.brandId))
  const brandIds = invite.brandIds.filter(id => validBrandIds.has(id))

  const passwordHash = await hashPortalPassword(password)
  const now = new Date()

  // Single transaction so the whole accept either lands or doesn't.
  const userId = await db.$transaction(async tx => {
    // Upsert the PortalUser. There may already be a row from a prior
    // (unaccepted) invite for the same email — we hydrate it. The
    // (portalId, email) unique key makes this safe.
    const user = await tx.portalUser.upsert({
      where: { portalId_email: { portalId: invite.portalId, email: invite.email } },
      create: {
        portalId: invite.portalId,
        email: invite.email,
        name,
        passwordHash,
        acceptedAt: now,
        lastLoginAt: now,
      },
      update: {
        name: name ?? undefined,
        passwordHash,
        isActive: true,
        acceptedAt: now,
        lastLoginAt: now,
      },
      select: { id: true },
    })

    // Replace-set: delete any existing assignments first, then insert
    // the new set. Lets a re-invite with a different brand list cleanly
    // overwrite without leaving stragglers.
    await tx.portalUserBrand.deleteMany({ where: { portalUserId: user.id } })
    if (brandIds.length > 0) {
      await tx.portalUserBrand.createMany({
        data: brandIds.map(brandId => ({ portalUserId: user.id, brandId })),
        skipDuplicates: true,
      })
    }

    await tx.portalInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: now },
    })

    return user.id
  })

  const jwt = await signPortalToken({ userId, portalId: invite.portalId, email: invite.email })
  await setPortalCookie(jwt)

  return NextResponse.json({ ok: true })
}
