import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

/**
 * List of simulation swarms. Each swarm is a batch of N sims queued
 * together; the cron worker processes them one per tick.
 */
export default async function AdminSwarmsPage() {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  const swarms = await db.simulationSwarm.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  }).catch(() => [])

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Simulation swarms</h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-xl">
            Queue many simulations at once across N agents × M personas.
            The processor picks one up per minute and runs it to completion
            with auto-review.
          </p>
        </div>
        <Link
          href="/admin/simulation-swarms/new"
          className="text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 transition-colors"
        >
          New swarm
        </Link>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 text-[10px] uppercase tracking-wider">
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-2 font-semibold">Name</th>
              <th className="text-left px-4 py-2 font-semibold">Created by</th>
              <th className="text-left px-4 py-2 font-semibold">Status</th>
              <th className="text-left px-4 py-2 font-semibold">Progress</th>
              <th className="text-left px-4 py-2 font-semibold">Agents × personas</th>
              <th className="text-left px-4 py-2 font-semibold">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {swarms.map(s => {
              const personas = Array.isArray(s.personaProfiles) ? s.personaProfiles.length : 0
              const pct = s.totalPlanned > 0
                ? Math.round(((s.totalComplete + s.totalFailed) / s.totalPlanned) * 100)
                : 0
              return (
                <tr key={s.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/simulation-swarms/${s.id}`} className="text-zinc-200 hover:text-white">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono">{s.createdByEmail}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                      s.status === 'complete' ? 'bg-emerald-500/10 text-emerald-400' :
                      s.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
                      s.status === 'queued' ? 'bg-zinc-800 text-zinc-400' :
                      'bg-zinc-900 text-zinc-500'
                    }`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">
                    {s.totalComplete + s.totalFailed}/{s.totalPlanned} ({pct}%)
                    {s.totalFailed > 0 && (
                      <span className="ml-2 text-red-400">· {s.totalFailed} failed</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">
                    {s.agentIds.length} × {personas} × {s.runsPerAgent} run
                    {s.runsPerAgent === 1 ? '' : 's'}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono">
                    {s.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                </tr>
              )
            })}
            {swarms.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No swarms yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
