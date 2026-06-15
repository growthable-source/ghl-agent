import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull } from '@/lib/admin-auth'
import PortalDetailClient from './PortalDetailClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Portal · Voxility Admin',
  robots: { index: false, follow: false },
}

type Params = { params: Promise<{ id: string }> }

export default async function PortalDetailPage({ params }: Params) {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  const { id } = await params

  const portal = await db.portal.findUnique({
    where: { id },
    include: {
      portalBrands: { include: { brand: { select: { id: true, name: true, slug: true } } } },
      users: {
        orderBy: { createdAt: 'asc' },
        include: { brandAssignments: { select: { brandId: true } } },
      },
      invites: {
        where: { acceptedAt: null },
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!portal) notFound()

  // All brands across workspaces, for the catalog picker.
  const allBrands = await db.brand.findMany({
    orderBy: [{ workspace: { name: 'asc' } }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, workspace: { select: { id: true, name: true } } },
  })

  const brands = portal.portalBrands.map(pb => pb.brand)
  const users = portal.users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    isActive: u.isActive,
    acceptedAt: u.acceptedAt?.toISOString() ?? null,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    invitedAt: u.invitedAt.toISOString(),
    brandIds: u.brandAssignments.map(a => a.brandId),
  }))
  const invites = portal.invites.map(i => ({
    id: i.id,
    email: i.email,
    expiresAt: i.expiresAt.toISOString(),
    createdAt: i.createdAt.toISOString(),
    brandIds: i.brandIds,
  }))

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <Link href="/admin/portals" className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← Portals
        </Link>
        <div className="flex items-center gap-3 mt-2">
          <h1 className="text-2xl font-semibold text-white">{portal.name}</h1>
          {!portal.isActive && (
            <span className="inline-block px-2 py-0.5 text-xs rounded bg-zinc-900 text-zinc-500 border border-zinc-800">
              Disabled
            </span>
          )}
        </div>
        <p className="text-sm text-zinc-400 mt-1">
          {brands.length} {brands.length === 1 ? 'brand' : 'brands'}
          <span className="mx-2 text-zinc-700">·</span>
          <span className="font-mono text-xs text-zinc-500">{portal.slug}</span>
        </p>
      </div>

      <PortalDetailClient
        portalId={portal.id}
        brands={brands}
        allBrands={allBrands}
        users={users}
        invites={invites}
        branding={{
          slug: portal.slug,
          customDomain: portal.customDomain,
          logoUrl: portal.logoUrl,
          primaryColor: portal.primaryColor,
        }}
      />
    </div>
  )
}
