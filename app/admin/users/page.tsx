import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

interface SearchParams {
  q?: string
  page?: string
}

const PAGE_SIZE = 50

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  const where: any = {}
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { companyName: { contains: q, mode: 'insensitive' } },
      { id: { contains: q } },
    ]
  }

  const [total, rows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true, name: true, email: true, companyName: true, role: true,
        createdAt: true, onboardingCompletedAt: true,
        workspaces: {
          select: { role: true, workspace: { select: { id: true, name: true, plan: true } } },
        },
      },
    }),
  ])

  logAdminAction({
    admin: session,
    action: 'view_users',
    meta: { q, page, rowsReturned: rows.length },
  }).catch(() => {})

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8 max-w-7xl space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Users</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {total.toLocaleString()} total · {rows.length} shown{q ? ' (filtered)' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/admin/export/users?${new URLSearchParams({ q }).toString()}`}
            className="text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-2 transition-colors"
          >
            Export CSV
          </a>
          <details className="relative">
            <summary className="list-none cursor-pointer text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-2 transition-colors">
              Send to webhook
            </summary>
            <WebhookForm entity="users" query={{ q }} />
          </details>
        </div>
      </div>

      <form method="get" className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name / email / company / id"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
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
              <th className="text-left px-4 py-2 font-semibold">User</th>
              <th className="text-left px-4 py-2 font-semibold">Company</th>
              <th className="text-left px-4 py-2 font-semibold">Workspaces</th>
              <th className="text-left px-4 py-2 font-semibold">Onboarded</th>
              <th className="text-left px-4 py-2 font-semibold">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {rows.map(u => (
              <tr key={u.id} className="hover:bg-zinc-900/50">
                <td className="px-4 py-2.5">
                  <div className="text-zinc-200">{u.name ?? '(no name)'}</div>
                  <div className="text-zinc-500">{u.email}</div>
                  <div className="text-zinc-600 font-mono text-[10px]">{u.id.slice(-10)}</div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="text-zinc-300">{u.companyName ?? '—'}</div>
                  {u.role && <div className="text-zinc-600 text-[10px]">{u.role}</div>}
                </td>
                <td className="px-4 py-2.5">
                  {u.workspaces.length === 0 ? (
                    <span className="text-zinc-600">none</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.workspaces.slice(0, 3).map(m => (
                        <span key={m.workspace.id} className="text-[10px] bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-400">
                          {m.workspace.name} <span className="text-zinc-600">· {m.role}</span>
                        </span>
                      ))}
                      {u.workspaces.length > 3 && (
                        <span className="text-[10px] text-zinc-600">+{u.workspaces.length - 3} more</span>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-zinc-500 font-mono">
                  {u.onboardingCompletedAt ? u.onboardingCompletedAt.toISOString().slice(0, 10) : '—'}
                </td>
                <td className="px-4 py-2.5 text-zinc-500 font-mono">
                  {u.createdAt.toISOString().slice(0, 10)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No users match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && <Pagination page={page} pages={pages} params={{ q }} />}
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

// Small disclosure-triggered form so ops can POST the current filtered set
// to an arbitrary webhook URL without leaving the page.
function WebhookForm({ entity, query }: { entity: string; query: Record<string, string> }) {
  return (
    <form
      action="/api/admin/webhook-export"
      method="post"
      className="absolute right-0 mt-2 z-20 w-80 rounded-lg border border-zinc-700 bg-zinc-950 shadow-xl p-3 space-y-2"
    >
      <input type="hidden" name="entity" value={entity} />
      {Object.entries(query).map(([k, v]) => (
        <input type="hidden" key={k} name={`q_${k}`} value={v} />
      ))}
      <label className="block text-[10px] uppercase tracking-wider text-zinc-500">Webhook URL</label>
      <input
        name="url"
        type="url"
        required
        placeholder="https://example.com/webhook"
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
      />
      <button
        type="submit"
        className="w-full text-xs font-medium bg-white text-black rounded px-3 py-1.5 hover:bg-zinc-200 transition-colors"
      >
        Fire POST
      </button>
      <p className="text-[10px] text-zinc-600">
        Sends JSON of the filtered set. Max 10,000 rows per call.
      </p>
    </form>
  )
}
