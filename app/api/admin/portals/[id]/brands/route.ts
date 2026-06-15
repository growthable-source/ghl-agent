import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { filterToAllowedBrands } from '@/lib/portal-brands'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

// PUT — replace-set the portal's brand catalog. Removing a brand from
// the catalog also revokes it from every user assignment in this portal
// and trims it from pending invites, so no one retains access to a
// brand the portal no longer offers.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: portalId } = await params

  let body: any = {}
  try { body = await req.json() } catch {}
  const incoming: string[] = Array.isArray(body?.brandIds)
    ? body.brandIds.filter((x: unknown) => typeof x === 'string')
    : []

  const portal = await db.portal.findUnique({ where: { id: portalId }, select: { id: true } })
  if (!portal) return NextResponse.json({ error: 'Portal not found' }, { status: 404 })

  // Only real, existing brands may enter the catalog (any workspace).
  const realBrands = incoming.length > 0
    ? await db.brand.findMany({ where: { id: { in: incoming } }, select: { id: true } })
    : []
  const filtered = filterToAllowedBrands(incoming, new Set(realBrands.map(b => b.id)))
  const filteredSet = new Set(filtered)

  // Pending invites referencing now-removed brands get trimmed.
  const pendingInvites = await db.portalInvite.findMany({
    where: { portalId, acceptedAt: null },
    select: { id: true, brandIds: true },
  })
  const inviteUpdates = pendingInvites
    .map(inv => ({ id: inv.id, next: inv.brandIds.filter(b => filteredSet.has(b)), prevLen: inv.brandIds.length }))
    .filter(u => u.next.length !== u.prevLen)

  // Empty catalog → revoke ALL user-brand rows for the portal (avoids
  // Prisma's ambiguous `notIn: []`).
  const revokeWhere = filtered.length > 0
    ? { portalUser: { portalId }, brandId: { notIn: filtered } }
    : { portalUser: { portalId } }

  await db.$transaction([
    db.portalUserBrand.deleteMany({ where: revokeWhere }),
    db.portalBrand.deleteMany({ where: { portalId } }),
    ...(filtered.length > 0
      ? [db.portalBrand.createMany({
          data: filtered.map(brandId => ({ portalId, brandId })),
          skipDuplicates: true,
        })]
      : []),
    ...inviteUpdates.map(u =>
      db.portalInvite.update({ where: { id: u.id }, data: { brandIds: u.next } }),
    ),
  ])

  logAdminActionAfter({ admin: session, action: 'update_portal_brands', target: portalId, meta: { brandIds: filtered } })
  return NextResponse.json({ ok: true, brandIds: filtered })
}
