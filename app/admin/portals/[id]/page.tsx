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
      workspace: {
        select: {
          id: true, name: true,
          brands: { select: { id: true, name: true, slug: true } },
        },
      },
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

  const brands = portal.workspace.brands
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
          Workspace:{' '}
          <Link href={`/admin/workspaces/${portal.workspace.id}`} className="text-zinc-300 hover:text-amber-400">
            {portal.workspace.name}
          </Link>
          <span className="mx-2 text-zinc-700">·</span>
          <span className="font-mono text-xs text-zinc-500">{portal.slug}</span>
        </p>
      </div>

      {brands.length === 0 ? (
        <div className="border border-amber-900/50 bg-amber-950/20 rounded-lg p-4 mb-6">
          <p className="text-sm text-amber-300">
            This workspace has no brands yet. Add brands to the workspace before inviting customers —
            portal users only see conversations for assigned brands.
          </p>
        </div>
      ) : null}

      <PortalDetailClient
        portalId={portal.id}
        brands={brands}
        users={users}
        invites={invites}
      />
    </div>
  )
}
