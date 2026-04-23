import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import NewBadge from '@/components/NewBadge'

// Ship date for the Simulation Swarm feature — used to time out the
// "NEW" badge automatically 90 days later. Bump if you ship a major
// iteration that deserves re-highlighting.
const SWARM_SHIPPED = '2026-04-23'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * Customer-facing simulations list.
 *
 * Shows every simulation the workspace has ever run, most recent first.
 * Clicking a row drills into the transcript + auto-proposed learnings.
 * The page is deliberately thin — no client-side polling, no live
 * progress. Simulations run synchronously on POST so by the time the
 * user lands on the list page they already have a completed row.
 */
export default async function SimulationsPage({ params }: Params) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const { workspaceId } = await params

  // Parallelize reads. Workspace membership was already checked at
  // the layout level.
  const [sims, agents, swarms] = await Promise.all([
    db.simulation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { agent: { select: { id: true, name: true } } },
    }).catch(() => []),
    db.agent.findMany({
      where: {
        OR: [{ workspaceId }, { location: { workspaceId } }],
        isActive: true,
      },
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
    }),
    // Customer swarms scoped to this workspace. Admin-driven platform
    // swarms (workspaceId=null) don't show up here.
    db.simulationSwarm.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }).catch(() => []),
  ])

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Simulations</h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-xl">
            Run synthetic conversations against your agents to find failures
            before your customers do. Every completed simulation is reviewed
            automatically — improvements land in the platform learnings
            queue for your approval.
          </p>
        </div>
        {agents.length > 0 ? (
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href={`/dashboard/${workspaceId}/simulations/swarm/new`}
              className="text-sm font-medium border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 rounded-lg px-4 py-2 transition-colors inline-flex items-center gap-2"
            >
              Simulation swarm
              <NewBadge since={SWARM_SHIPPED} />
            </Link>
            <Link
              href={`/dashboard/${workspaceId}/simulations/new`}
              className="text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2 transition-colors"
            >
              New simulation
            </Link>
          </div>
        ) : (
          <span className="text-xs text-zinc-500">Create an agent first to run simulations.</span>
        )}
      </div>

      {/* Recent swarms — shown only when there's at least one so we
          don't waste vertical space on a "no swarms yet" empty state. */}
      {swarms.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Recent swarms</h2>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
            {swarms.map(s => {
              const done = s.totalComplete + s.totalFailed
              const pct = s.totalPlanned > 0 ? Math.round((done / s.totalPlanned) * 100) : 0
              const isActive = s.status !== 'complete' && done < s.totalPlanned
              return (
                <Link
                  key={s.id}
                  href={`/dashboard/${workspaceId}/simulations/swarm/${s.id}`}
                  className="block px-4 py-3 hover:bg-zinc-900/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{s.name}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        {done}/{s.totalPlanned} done ({pct}%)
                        {s.totalFailed > 0 && <span className="text-red-400"> · {s.totalFailed} failed</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {isActive && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                      )}
                      <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                        s.status === 'complete' ? 'bg-emerald-500/10 text-emerald-400' :
                        isActive ? 'bg-blue-500/10 text-blue-400' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>{isActive ? 'running' : s.status}</span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 text-[10px] uppercase tracking-wider">
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-2 font-semibold">Agent</th>
              <th className="text-left px-4 py-2 font-semibold">Persona</th>
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
                    href={`/dashboard/${workspaceId}/simulations/${s.id}`}
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
                  {s.goal && (
                    <span className="text-zinc-600"> · {s.goal.slice(0, 40)}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <StatusChip status={s.status} />
                </td>
                <td className="px-4 py-2.5 text-zinc-400">{s.turnCount}</td>
                <td className="px-4 py-2.5">
                  {s.proposedLearningsCount > 0 ? (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300 bg-amber-500/10 rounded px-1.5 py-0.5">
                      {s.proposedLearningsCount}
                    </span>
                  ) : (
                    <span className="text-zinc-700">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-zinc-500 font-mono">
                  {s.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </td>
              </tr>
            ))}
            {sims.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-zinc-500">
                  No simulations yet. Click &ldquo;New simulation&rdquo; to run your first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'complete' ? 'text-emerald-400 bg-emerald-500/10' :
    status === 'running' ? 'text-blue-400 bg-blue-500/10' :
    status === 'queued' ? 'text-zinc-400 bg-zinc-800' :
    status === 'failed' ? 'text-red-400 bg-red-500/10' :
    'text-zinc-500 bg-zinc-900'
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${cls}`}>
      {status}
    </span>
  )
}
