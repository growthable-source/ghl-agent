import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Search = Promise<{ status?: string; workspace?: string }>

const STATUSES = ['queued', 'running', 'complete', 'failed', 'all'] as const

/**
 * Admin-wide simulations list. Every simulation across every workspace,
 * filterable by status. This is read-only — admins don't kick off
 * customer simulations from here; they use swarms instead.
 */
export default async function AdminSimulationsPage({ searchParams }: { searchParams: Search }) {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const statusFilter = typeof sp.status === 'string' && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : 'all'
  const workspaceFilter = sp.workspace?.trim() ?? ''

  const where: any = {
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(workspaceFilter ? { workspaceId: workspaceFilter } : {}),
  }

  type CountRow = { status: string; _count: { _all: number } }
  const [sims, workspaces, counts] = await Promise.all([
    db.simulation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        agent: { select: { name: true } },
      },
    }).catch(() => []),
    db.workspace.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'desc' }, take: 500 }),
    db.simulation.groupBy({ by: ['status'], _count: { _all: true } }).catch((): CountRow[] => []),
  ]) as [any[], Array<{ id: string; name: string }>, CountRow[]]

  const countMap = new Map(counts.map(c => [c.status, c._count._all]))

  logAdminAction({ admin: session, action: 'view_simulations_list' }).catch(() => {})

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Simulations</h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-xl">
            Every synthetic conversation across every workspace. Each one
            auto-generates a review that proposes platform learnings.
          </p>
        </div>
        <Link
          href="/admin/simulation-swarms"
          className="text-sm font-medium border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 rounded-lg px-4 py-2 transition-colors"
        >
          Swarms →
        </Link>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-2 flex-wrap border-b border-zinc-800 pb-3">
        {STATUSES.map(s => {
          const active = statusFilter === s
          const count = s === 'all' ? counts.reduce((acc, c) => acc + c._count._all, 0) : countMap.get(s) ?? 0
          return (
            <Link
              key={s}
              href={{ pathname: '/admin/simulations', query: { status: s, ...(workspaceFilter ? { workspace: workspaceFilter } : {}) } }}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
                active ? 'bg-zinc-900 text-white border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <span className="capitalize">{s}</span>
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  s === 'failed' ? 'bg-red-500/20 text-red-300' :
                  s === 'running' || s === 'queued' ? 'bg-blue-500/20 text-blue-300' :
                  s === 'complete' ? 'bg-emerald-500/20 text-emerald-300' :
                  'bg-zinc-800 text-zinc-500'
                }`}>{count}</span>
              )}
            </Link>
          )
        })}
      </div>

      {/* Workspace filter */}
      <form className="flex items-center gap-2 text-xs" method="get">
        <input type="hidden" name="status" value={statusFilter} />
        <span className="text-zinc-500">Workspace:</span>
        <select
          name="workspace"
          defaultValue={workspaceFilter}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-200"
        >
          <option value="">all</option>
          {workspaces.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <button type="submit" className="text-zinc-400 hover:text-white px-2">apply</button>
      </form>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 text-[10px] uppercase tracking-wider">
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-2 font-semibold">Agent</th>
              <th className="text-left px-4 py-2 font-semibold">Persona</th>
              <th className="text-left px-4 py-2 font-semibold">Source</th>
              <th className="text-left px-4 py-2 font-semibold">Status</th>
              <th className="text-left px-4 py-2 font-semibold">Turns</th>
              <th className="text-left px-4 py-2 font-semibold">Learnings</th>
              <th className="text-left px-4 py-2 font-semibold">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {sims.map(s => (
              <tr key={s.id} className="hover:bg-zinc-900/40">
                <td className="px-4 py-2.5">
                  <Link
                    href={s.workspaceId
                      ? `/dashboard/${s.workspaceId}/simulations/${s.id}`
                      : `/admin/simulations`}
                    className="text-zinc-200 hover:text-white"
                  >
                    {s.agent?.name ?? s.agentId}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-zinc-400">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-2">
                    {s.style.replace(/_/g, ' ')}
                  </span>
                  {s.channel}
                </td>
                <td className="px-4 py-2.5 text-zinc-500 font-mono">
                  {s.createdByType}
                  {s.swarmId && (
                    <Link href={`/admin/simulation-swarms/${s.swarmId}`} className="ml-1 text-blue-400 hover:text-blue-300">
                      swarm
                    </Link>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                    s.status === 'complete' ? 'bg-emerald-500/10 text-emerald-400' :
                    s.status === 'running' || s.status === 'queued' ? 'bg-blue-500/10 text-blue-400' :
                    s.status === 'failed' ? 'bg-red-500/10 text-red-400' :
                    'bg-zinc-800 text-zinc-500'
                  }`}>{s.status}</span>
                </td>
                <td className="px-4 py-2.5 text-zinc-400">{s.turnCount}</td>
                <td className="px-4 py-2.5">
                  {s.proposedLearningsCount > 0 ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300 bg-amber-500/10 rounded px-1.5 py-0.5">
                      {s.proposedLearningsCount}
                    </span>
                  ) : <span className="text-zinc-700">—</span>}
                </td>
                <td className="px-4 py-2.5 text-zinc-500 font-mono">
                  {s.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </td>
              </tr>
            ))}
            {sims.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No simulations match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
