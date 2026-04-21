import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

interface SearchParams {
  action?: string
  adminEmail?: string
  page?: string
}

const PAGE_SIZE = 100

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const action = (sp.action ?? '').trim()
  const adminEmail = (sp.adminEmail ?? '').trim()
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  const where: any = {}
  if (action) where.action = action
  if (adminEmail) where.adminEmail = { contains: adminEmail, mode: 'insensitive' }

  const [total, rows] = await Promise.all([
    db.adminAuditLog.count({ where }),
    db.adminAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
    }),
  ])

  // Browsing the audit trail is itself auditable — but skip logging audit
  // views to avoid an infinite feedback loop that bloats the table.

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8 max-w-6xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Audit trail</h1>
        <p className="text-sm text-zinc-500 mt-1">
          {total.toLocaleString()} actions logged · {rows.length} shown.
          Includes every admin login, page view, export, and webhook fire.
        </p>
      </div>

      <form method="get" className="flex flex-wrap gap-2">
        <input
          name="action"
          defaultValue={action}
          placeholder="Action (e.g. export_users_csv)"
          className="flex-1 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono text-xs"
        />
        <input
          name="adminEmail"
          defaultValue={adminEmail}
          placeholder="Admin email contains…"
          className="flex-1 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <button
          type="submit"
          className="text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 transition-colors"
        >
          Filter
        </button>
      </form>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 text-[10px] uppercase tracking-wider">
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-2 font-semibold">When</th>
              <th className="text-left px-4 py-2 font-semibold">Admin</th>
              <th className="text-left px-4 py-2 font-semibold">Action</th>
              <th className="text-left px-4 py-2 font-semibold">Target</th>
              <th className="text-left px-4 py-2 font-semibold">IP</th>
              <th className="text-left px-4 py-2 font-semibold">Meta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-zinc-900/50">
                <td className="px-4 py-2 text-zinc-600 font-mono whitespace-nowrap">
                  {r.createdAt.toISOString().slice(0, 19).replace('T', ' ')}
                </td>
                <td className="px-4 py-2 text-zinc-300">{r.adminEmail}</td>
                <td className="px-4 py-2 text-zinc-300 font-mono">{r.action}</td>
                <td className="px-4 py-2 text-zinc-500 font-mono">{r.target ?? '—'}</td>
                <td className="px-4 py-2 text-zinc-600 font-mono">{r.ipAddress ?? '—'}</td>
                <td className="px-4 py-2 text-zinc-600 font-mono max-w-[280px] truncate" title={r.meta ? JSON.stringify(r.meta) : ''}>
                  {r.meta ? JSON.stringify(r.meta) : ''}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No audit entries match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && <Pagination page={page} pages={pages} params={{ action, adminEmail }} />}
    </div>
  )
}

function Pagination({ page, pages, params }: { page: number; pages: number; params: Record<string, string> }) {
  const mk = (p: number) => `?${new URLSearchParams({ ...params, page: String(p) }).toString()}`
  return (
    <div className="flex items-center justify-between text-xs text-zinc-500">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Link href={mk(page - 1)} className="text-blue-400 hover:text-blue-300">← Previous</Link>}
        {page < pages && <Link href={mk(page + 1)} className="text-blue-400 hover:text-blue-300">Next →</Link>}
      </div>
    </div>
  )
}
