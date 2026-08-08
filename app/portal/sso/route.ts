/**
 * GET /portal/sso?t=<token> — partner-minted single-use portal sign-in.
 *
 * Redeems the token, ensures the PortalUser exists (created accepted and
 * passwordless on first redemption — the partner authenticated this
 * person, which is the same trust that lets provisioning create their
 * account), signs a real portal session, and lands them on the portal.
 *
 * Passwordless here does not mean locked out of the normal login: the
 * invite email still goes out at provision time, and accepting it sets a
 * password on this same row. The two paths converge on one PortalUser.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { consumePortalSsoToken } from '@/lib/partner/portal-token'
import { signPortalToken, setPortalCookie } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const raw = (url.searchParams.get('t') || '').trim()

  const fail = (slugHint: string | null, reason: 'expired' | 'invalid') => {
    const login = new URL('/portal/login', url.origin)
    if (slugHint) login.searchParams.set('p', slugHint)
    login.searchParams.set('sso', reason)
    return NextResponse.redirect(login)
  }

  if (!raw) return fail(null, 'invalid')

  const result = await consumePortalSsoToken(raw)
  if (!result.ok) return fail(null, result.reason === 'expired' ? 'expired' : 'invalid')

  const portal = await db.portal.findUnique({
    where: { id: result.portalId },
    select: {
      id: true, slug: true, isActive: true,
      portalBrands: { select: { brandId: true } },
    },
  })
  if (!portal || !portal.isActive) return fail(null, 'invalid')

  const email = result.email!.toLowerCase()

  // First redemption creates the user, accepted, with the portal's full
  // brand catalog (partner portals expose exactly one brand — theirs).
  // Later redemptions must NOT overwrite brand assignments an operator
  // may have narrowed since, so update only touches lastLoginAt.
  let user = await db.portalUser.findUnique({
    where: { portalId_email: { portalId: portal.id, email } },
    select: { id: true, isActive: true },
  })
  if (!user) {
    const created = await db.portalUser.create({
      data: {
        portalId: portal.id,
        email,
        acceptedAt: new Date(),
        lastLoginAt: new Date(),
        brandAssignments: {
          create: portal.portalBrands.map(pb => ({ brandId: pb.brandId })),
        },
      },
      select: { id: true, isActive: true },
    })
    // The pending invite (if any) is now moot — mark it accepted so the
    // admin list doesn't show a ghost invite for an active user.
    await db.portalInvite.updateMany({
      where: { portalId: portal.id, email, acceptedAt: null },
      data: { acceptedAt: new Date() },
    }).catch(() => {})
    user = created
  } else if (!user.isActive) {
    // A deactivated user stays deactivated — an SSO link is a login
    // path, not an override of an operator's revocation.
    return fail(portal.slug, 'invalid')
  } else {
    await db.portalUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    }).catch(() => {})
  }

  const token = await signPortalToken({ userId: user.id, portalId: portal.id, email })
  await setPortalCookie(token)

  return NextResponse.redirect(new URL('/portal', url.origin))
}
