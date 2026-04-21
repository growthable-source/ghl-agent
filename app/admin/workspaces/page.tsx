import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

interface SearchParams {
  q?: string
  plan?: string
  page?: string
}

const PAGE_SIZE = 50

export default async function AdminWorkspacesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const plan = (sp.plan ?? '').trim()
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  // Filter builder. We search across name/slug/domain/id because support
  // tickets cite any of them.
  const where: any = {}
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { slug: { contains: q, mode: 'insensitive' } },
      { domain: { contains: q, mode: 'insensitive' } },
      { id: { contains: q } },
    ]
  }
  if (plan) where.plan = plan

  const [total, rows] = await Promise.all([
    db.workspace.count({ where }),
    db.workspace.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true, name: true, slug: true, plan: true,
        isPaused: true, pausedAt: true,
        agentLimit: true, messageUsage: true, messageLimit: true,
        trialEndsAt: true, createdAt: true,
        stripeCustomerId: true,
        _count: { select: { members: true, agents: true } },
      },
    }),
  ])

  logAdminAction({
    admin: session,
    action: 'view_workspaces',
    meta: { q, plan, page, rowsReturned: rows.length },
  }).catch(() => {})

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8 max-w-7xl space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Workspaces</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {total.toLocaleString()} total · {rows.length} shown{q || plan ? ' (filtered)' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/admin/export/workspaces?${new URLSearchParams({ q, plan }).toString()}`}
            className="text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-2 transition-colors"
          >
            Export CSV
          </a>
        </div>
      </div>

      {/* Filters — GET form so URL reflects state, which makes support
          tickets shareable via link. */}
      <form method="get" className="flex flex-wrap gap-2 items-center">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name / slug / domain / id"
          className="flex-1 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
        />
        <select
          name="plan"
          defaultValue={plan}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
        >
          <option value="">All plans</option>
          <option value="trial">Trial</option>
          <option value="starter">Starter</option>
          <option value="growth">Growth</option>
          <option value="scale">Scale</option>
        </select>
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
              <th className="text-left px-4 py-2 font-semibold">Name</th>
              <th className="text-left px-4 py-2 font-semibold">Plan</th>
              <th className="text-right px-4 py-2 font-semibold">Members</th>
              <th className="text-right px-4 py-2 font-semibold">Agents</th>
              <th className="text-right px-4 py-2 font-semibold">Messages</th>
              <th className="text-left px-4 py-2 font-semibold">Trial ends</th>
              <th className="text-left px-4 py-2 font-semibold">Created</th>
              <th className="text-left px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {rows.map(w => (
              <tr key={w.id} className="hover:bg-zinc-900/50">
                <td className="px-4 py-2.5">
                  <div className="text-zinc-200">{w.name}</div>
                  <div className="text-zinc-600 font-mono">{w.slug} · {w.id.slice(-8)}</div>
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                    w.plan === 'trial' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30' :
                    'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  }`}>
                    {w.plan}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-zinc-400">{w._count.members}</td>
                <td className="px-4 py-2.5 text-right text-zinc-400">{w._count.agents}</td>
                <td className="px-4 py-2.5 text-right text-zinc-400">
                  {w.messageUsage.toLocaleString()}
                  {w.messageLimit > 0 && (
                    <span className="text-zinc-600"> / {w.messageLimit.toLocaleString()}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-zinc-500 font-mono">
                  {w.trialEndsAt ? w.trialEndsAt.toISOString().slice(0, 10) : '—'}
                </td>
                <td className="px-4 py-2.5 text-zinc-500 font-mono">
                  {w.createdAt.toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-2.5">
                  {w.isPaused ? (
                    <span className="text-red-400">Paused</span>
                  ) : w.stripeCustomerId ? (
                    <span className="text-emerald-400">Active · Stripe</span>
                  ) : (
                    <span className="text-zinc-500">Active</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-xs text-zinc-500">
                  No workspaces match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <Pagination page={page} pages={pages} params={{ q, plan }} />
      )}
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
