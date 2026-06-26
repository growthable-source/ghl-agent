import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Portals · Xovera Admin',
  robots: { index: false, follow: false },
}

export default async function AdminPortalsPage() {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  const portals = await db.portal.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { users: true, invites: true, portalBrands: true } },
    },
  })

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Customer portals</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Read-only conversation/CSAT views for your customers, scoped per brand.
          </p>
        </div>
        <Link
          href="/admin/portals/new"
          className="inline-flex items-center px-3 py-1.5 rounded bg-amber-400 text-zinc-950 text-sm font-medium hover:bg-amber-300 transition-colors"
        >
          New portal
        </Link>
      </div>

      {portals.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-lg p-10 text-center">
          <p className="text-zinc-400 text-sm">No portals yet.</p>
          <Link
            href="/admin/portals/new"
            className="inline-block mt-3 text-amber-400 hover:text-amber-300 text-sm"
          >
            Create the first one →
          </Link>
        </div>
      ) : (
        <div className="border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Portal</th>
                <th className="text-left px-4 py-2 font-medium">Brands</th>
                <th className="text-left px-4 py-2 font-medium">Users</th>
                <th className="text-left px-4 py-2 font-medium">Pending invites</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {portals.map(p => (
                <tr key={p.id} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                  <td className="px-4 py-3">
                    <Link href={`/admin/portals/${p.id}`} className="text-zinc-100 hover:text-amber-400 font-medium">
                      {p.name}
                    </Link>
                    <p className="text-xs text-zinc-500 font-mono mt-0.5">{p.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-zinc-300">{p._count.portalBrands}</td>
                  <td className="px-4 py-3 text-zinc-300">{p._count.users}</td>
                  <td className="px-4 py-3 text-zinc-300">{p._count.invites}</td>
                  <td className="px-4 py-3">
                    {p.isActive ? (
                      <span className="inline-block px-2 py-0.5 text-xs rounded bg-emerald-950 text-emerald-300 border border-emerald-900">Active</span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 text-xs rounded bg-zinc-900 text-zinc-500 border border-zinc-800">Disabled</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {new Date(p.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
