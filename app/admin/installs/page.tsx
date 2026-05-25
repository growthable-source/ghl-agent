import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

interface SearchParams {
  q?: string
  source?: string
  page?: string
}

const PAGE_SIZE = 50

/**
 * Lead registry of marketplace installs.
 *
 * One row per install event (initial install + every subsequent
 * reconnect). Filters by source ('ghl_marketplace' | 'shopify_app' |
 * 'hubspot_marketplace') and full-text against location/company/user
 * names + emails. Export-as-CSV uses the same filter state.
 */
export default async function AdminInstallsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const source = (sp.source ?? '').trim()
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  const where: any = {}
  if (source) where.source = source
  if (q) {
    where.OR = [
      { locationName: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
      { userName: { contains: q, mode: 'insensitive' } },
      { userEmail: { contains: q, mode: 'insensitive' } },
      { locationEmail: { contains: q, mode: 'insensitive' } },
      { companyEmail: { contains: q, mode: 'insensitive' } },
      { externalLocationId: { contains: q } },
    ]
  }

  // Wrap in try/catch so a missing table (un-migrated DB) doesn't
  // render a stack trace — show a "Run the migration" CTA instead.
  let total = 0
  let rows: any[] = []
  let notMigrated = false
  try {
    const [t, r] = await Promise.all([
      db.marketplaceInstall.count({ where }),
      db.marketplaceInstall.findMany({
        where,
        orderBy: { installedAt: 'desc' },
        skip,
        take: PAGE_SIZE,
        include: {
          workspace: { select: { id: true, name: true, slug: true } },
        },
      }),
    ])
    total = t
    rows = r
  } catch (err: any) {
    if (err?.message?.includes('does not exist') || err?.code === 'P2021') {
      notMigrated = true
    } else {
      throw err
    }
  }

  logAdminAction({
    admin: session,
    action: 'view_installs',
    meta: { q, source, page, rowsReturned: rows.length },
  })

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Preserve filter state in the CSV export link so the file matches
  // what the admin currently sees on screen.
  const csvParams = new URLSearchParams()
  if (q) csvParams.set('q', q)
  if (source) csvParams.set('source', source)
  const csvHref = `/api/admin/installs/csv${csvParams.toString() ? '?' + csvParams.toString() : ''}`

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Marketplace installs</h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Lead snapshot captured at every marketplace OAuth completion — sub-account, agency, and installing user.
            Survives disconnect. Reconnects appear as new rows so re-engagement shows up here too.
          </p>
        </div>
        <a
          href={csvHref}
          className="text-xs font-semibold px-3 py-2 rounded border border-zinc-700 text-zinc-200 hover:border-zinc-500 transition-colors"
        >
          Export CSV ↓
        </a>
      </div>

      {notMigrated && (
        <div className="mb-4 p-3 rounded border border-amber-700 bg-amber-950/40 text-xs text-amber-300">
          MarketplaceInstall table doesn&apos;t exist yet — run
          <code className="mx-1 px-1 py-0.5 rounded bg-amber-900/60">prisma/migrations-legacy/manual_marketplace_installs.sql</code>
          against the DB.
        </div>
      )}

      {/* Filters */}
      <form className="flex gap-2 mb-4" method="get">
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="Search location / company / user / email…"
          className="flex-1 text-xs px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <select
          name="source"
          defaultValue={source}
          className="text-xs px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-zinc-200 focus:outline-none focus:border-zinc-600"
        >
          <option value="">All sources</option>
          <option value="ghl_marketplace">LeadConnector</option>
          <option value="shopify_app">Shopify</option>
          <option value="hubspot_marketplace">HubSpot</option>
        </select>
        <button
          type="submit"
          className="text-xs px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 hover:border-zinc-500 transition-colors"
        >
          Filter
        </button>
      </form>

      <div className="text-[11px] text-zinc-500 mb-2">{total} install{total === 1 ? '' : 's'} {q || source ? '(filtered)' : ''}</div>

      <div className="rounded border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-zinc-950">
            <tr className="text-left text-zinc-500">
              <th className="px-3 py-2 font-medium">Installed</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Company / Agency</th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Synced</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.map(row => (
              <tr key={row.id} className="hover:bg-zinc-950/60">
                <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">
                  {new Date(row.installedAt).toLocaleString()}
                </td>
                <td className="px-3 py-2 text-zinc-400">{sourceLabel(row.source)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-zinc-200">{row.locationName ?? <span className="text-zinc-600">—</span>}</div>
                  <div className="text-[10px] text-zinc-500 truncate max-w-[18ch]" title={row.locationEmail ?? ''}>
                    {row.locationEmail ?? ''}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="text-zinc-300">{row.companyName ?? <span className="text-zinc-600">—</span>}</div>
                  {row.companyWebsite && (
                    <div className="text-[10px] text-zinc-500 truncate max-w-[18ch]">{row.companyWebsite}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="text-zinc-300">{row.userName ?? <span className="text-zinc-600">—</span>}</div>
                  <div className="text-[10px] text-zinc-500 truncate max-w-[20ch]" title={row.userEmail ?? ''}>
                    {row.userEmail ?? ''}
                  </div>
                </td>
                <td className="px-3 py-2 text-zinc-400 whitespace-nowrap">
                  {row.syncedToGhlAt
                    ? <span className="text-emerald-400">✓ {new Date(row.syncedToGhlAt).toLocaleDateString()}</span>
                    : <span className="text-zinc-600">—</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-right">
                  <form action={`/api/admin/installs/${row.id}/sync-to-ghl`} method="post" className="inline">
                    <button
                      type="submit"
                      className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors mr-1"
                    >
                      Sync to GHL
                    </button>
                  </form>
                  <Link
                    href={`/admin/workspaces/${row.workspace?.id}`}
                    className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500 transition-colors"
                  >
                    Workspace →
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !notMigrated && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-zinc-500">
                  No installs yet.{q || source ? ' Try clearing the filter.' : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-xs">
          <span className="text-zinc-500">Page {page} of {totalPages}</span>
          <div className="flex gap-1">
            {page > 1 && (
              <Link
                href={`/admin/installs?${new URLSearchParams({ ...(q && { q }), ...(source && { source }), page: String(page - 1) }).toString()}`}
                className="px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500"
              >Prev</Link>
            )}
            {page < totalPages && (
              <Link
                href={`/admin/installs?${new URLSearchParams({ ...(q && { q }), ...(source && { source }), page: String(page + 1) }).toString()}`}
                className="px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500"
              >Next</Link>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'ghl_marketplace': return 'LeadConnector'
    case 'shopify_app': return 'Shopify'
    case 'hubspot_marketplace': return 'HubSpot'
    default: return source
  }
}
