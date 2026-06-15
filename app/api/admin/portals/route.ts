import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { filterToAllowedBrands } from '@/lib/portal-brands'

export const dynamic = 'force-dynamic'

// POST /api/admin/portals — create a customer portal. A portal is a
// named set of brands + its users; it is no longer scoped to a single
// workspace. Optionally seed the brand catalog with `brandIds`.
export async function POST(req: NextRequest) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any = {}
  try { body = await req.json() } catch {}

  const name = String(body?.name ?? '').trim()
  const slug = String(body?.slug ?? '').trim().toLowerCase()
  const brandIds: string[] = Array.isArray(body?.brandIds)
    ? body.brandIds.filter((x: unknown) => typeof x === 'string')
    : []

  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return NextResponse.json({ error: 'slug must be lowercase letters, digits, dashes' }, { status: 400 })
  }
  if (slug.length > 60) {
    return NextResponse.json({ error: 'slug too long (max 60 chars)' }, { status: 400 })
  }

  // Slug is globally unique — the portal is reachable by slug from a
  // public URL (e.g. /portal/login?p=acme).
  const existing = await db.portal.findUnique({ where: { slug }, select: { id: true } })
  if (existing) return NextResponse.json({ error: 'slug already taken' }, { status: 409 })

  // Seed the catalog with any provided real brand IDs (optional).
  const realBrands = brandIds.length > 0
    ? await db.brand.findMany({ where: { id: { in: brandIds } }, select: { id: true } })
    : []
  const seedIds = filterToAllowedBrands(brandIds, new Set(realBrands.map(b => b.id)))

  const portal = await db.portal.create({
    data: {
      name,
      slug,
      ...(seedIds.length > 0
        ? { portalBrands: { create: seedIds.map(brandId => ({ brandId })) } }
        : {}),
    },
    select: { id: true, slug: true, name: true },
  })

  logAdminActionAfter({ admin: session, action: 'create_portal', target: portal.id, meta: { slug, name, brandIds: seedIds } })
  return NextResponse.json({ portal })
}
