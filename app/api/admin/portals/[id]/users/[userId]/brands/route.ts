import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { filterToAllowedBrands } from '@/lib/portal-brands'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string; userId: string }> }

// PUT — replace the user's brand-assignment set. The body is the
// authoritative new list; missing IDs are removed, new ones added.
// Brand IDs outside the portal's workspace are silently dropped.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId, userId } = await params

  let body: any = {}
  try { body = await req.json() } catch {}
  const incoming: string[] = Array.isArray(body?.brandIds)
    ? body.brandIds.filter((x: unknown) => typeof x === 'string')
    : []

  const user = await db.portalUser.findUnique({
    where: { id: userId },
    select: {
      id: true, portalId: true, email: true,
      portal: { select: { portalBrands: { select: { brandId: true } } } },
    },
  })
  if (!user || user.portalId !== portalId) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const filtered = filterToAllowedBrands(incoming, new Set(user.portal.portalBrands.map(pb => pb.brandId)))

  // Replace-set semantics: delete all, then insert the new set, in a
  // transaction so we never leave the user with a half-updated ACL.
  await db.$transaction([
    db.portalUserBrand.deleteMany({ where: { portalUserId: userId } }),
    ...(filtered.length > 0
      ? [db.portalUserBrand.createMany({
          data: filtered.map(brandId => ({ portalUserId: userId, brandId })),
          skipDuplicates: true,
        })]
      : []),
  ])

  logAdminActionAfter({
    admin: session,
    action: 'update_portal_user_brands',
    target: userId,
    meta: { portalId, email: user.email, brandIds: filtered },
  })

  return NextResponse.json({ ok: true, brandIds: filtered })
}
