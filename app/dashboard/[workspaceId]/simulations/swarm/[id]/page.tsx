import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import SimulationAutoRefresh from '@/components/dashboard/SimulationAutoRefresh'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string; id: string }> }

/**
 * Customer-side swarm detail page.
 *
 * Shows the scenario the user gave, persona × status grid, aggregate
 * progress, and the applied learnings across all sims once they
 * complete. Auto-refreshes while anything is still queued or running
 * (same component the single-sim page uses), then stops polling when
 * the whole swarm hits its terminal state.
 */
export default async function CustomerSwarmDetail({ params }: Params) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const { workspaceId, id } = await params

  const swarm = await db.simulationSwarm.findFirst({
    where: { id, workspaceId },
    include: {
      simulations: {
        orderBy: { createdAt: 'asc' },
        include: { agent: { select: { name: true } } },
      },
    },
  })
  if (!swarm) notFound()

  // Aggregate applied learnings across the swarm's simulations. One sim
  // typically produces 0-2 learnings; 7-sim swarm → usually under 10.
  const reviewIds = swarm.simulations.map(s => s.reviewId).filter((x): x is string => !!x)
  const learnings = reviewIds.length > 0
    ? await db.platformLearning.findMany({
        where: { sourceReviewId: { in: reviewIds } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, scope: true, type: true, title: true, content: true,
          rationale: true, status: true, sourceReviewId: true,
        },
      })
    : []

  // Infer swarm-level status from its children. The cron worker
  // updates SimulationSwarm.status on each tick but there's a small
  // window where the last child just finished but the swarm row
  // hasn't caught up yet. Computing here from the children guarantees
  // the page agrees with itself.
  const statusCounts = swarm.simulations.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
  const queued = statusCounts.queued ?? 0
  const running = statusCounts.running ?? 0
  const complete = statusCounts.complete ?? 0
  const failed = statusCounts.failed ?? 0
  const inFlight = queued + running > 0
  const overallStatus = inFlight ? 'running' : swarm.simulations.length === 0 ? 'queued' : 'complete'
  const progressPct = swarm.totalPlanned > 0
    ? Math.round(((complete + failed) / swarm.totalPlanned) * 100)
    : 0

  const appliedCount = learnings.filter(l => l.status === 'applied').length

  // The scenario is in personaProfiles[0].context (every persona in a
  // customer swarm shares the same scenario text).
  const personaProfiles = Array.isArray(swarm.personaProfiles) ? swarm.personaProfiles as any[] : []
  const scenario = personaProfiles[0]?.context as string | undefined
  const channel = personaProfiles[0]?.channel as string | undefined

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <SimulationAutoRefresh status={overallStatus} />
      <div>
        <Link href={`/dashboard/${workspaceId}/simulations`} className="text-xs text-zinc-500 hover:text-white">
          ← Simulations
        </Link>
        <h1 className="text-xl font-semibold mt-2">{swarm.name}</h1>
        <p className="text-xs text-zinc-500 mt-1 font-mono">
          {channel ?? '—'} · {swarm.totalPlanned} sim{swarm.totalPlanned === 1 ? '' : 's'} · {swarm.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
        </p>
      </div>

      {/* Progress */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-200">
            Progress: {complete + failed}/{swarm.totalPlanned}
            <span className="text-zinc-500 ml-2 text-xs">({progressPct}%)</span>
          </h2>
          <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
            overallStatus === 'complete' ? 'bg-emerald-500/10 text-emerald-400' :
            overallStatus === 'running' ? 'bg-blue-500/10 text-blue-400' :
            'bg-zinc-800 text-zinc-400'
          }`}>{overallStatus}</span>
        </div>
        <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {inFlight && (
          <p className="text-[11px] text-zinc-500 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Processor runs one per minute. Page auto-refreshes until every persona has had their turn.
          </p>
        )}
        {!inFlight && swarm.simulations.length > 0 && (
          <p className="text-[11px] text-emerald-400">
            ✓ All personas done. {failed > 0 && <span className="text-red-400">({failed} failed)</span>}
          </p>
        )}
      </section>

      {/* Scenario */}
      {scenario && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="text-sm font-medium text-zinc-200 mb-2">Scenario</h2>
          <p className="text-xs text-zinc-400 whitespace-pre-wrap">{scenario}</p>
        </section>
      )}

      {/* Per-sim grid */}
      <section>
        <h2 className="text-sm font-medium text-zinc-200 mb-3">Simulations ({swarm.simulations.length})</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="text-zinc-500 text-[10px] uppercase tracking-wider">
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-2 font-semibold">Persona</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
                <th className="text-left px-4 py-2 font-semibold">Turns</th>
                <th className="text-left px-4 py-2 font-semibold">Learnings</th>
                <th className="text-left px-4 py-2 font-semibold">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {swarm.simulations.map(s => (
                <tr key={s.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-2.5 text-zinc-200">
                    {s.style.replace(/_/g, ' ')}
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
                  <td className="px-4 py-2.5 text-zinc-400">
                    {s.proposedLearningsCount > 0 ? (
                      <span className="text-amber-300">{s.proposedLearningsCount}</span>
                    ) : <span className="text-zinc-700">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/dashboard/${workspaceId}/simulations/${s.id}`}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
              {swarm.simulations.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    Nothing queued — try creating a new swarm.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Aggregate findings — what got applied across the swarm */}
      {!inFlight && learnings.length > 0 && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/[0.03] p-4 space-y-3">
          <h2 className="text-sm font-medium text-zinc-200">
            Swarm findings
            <span className={`ml-2 text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
              appliedCount === learnings.length
                ? 'bg-emerald-500/10 text-emerald-300'
                : 'bg-amber-500/10 text-amber-300'
            }`}>
              {appliedCount === learnings.length
                ? `${learnings.length} applied`
                : `${appliedCount}/${learnings.length} applied`}
            </span>
          </h2>
          <p className="text-[11px] text-zinc-500">
            Each finding is one prompt improvement the auto-reviewer proposed across
            your simulations. Applied ones are already live on your agent; open the
            individual simulation to retire any that didn&apos;t land right.
          </p>
          <div className="space-y-2">
            {learnings.map(l => (
              <div key={l.id} className="rounded border border-zinc-800 bg-zinc-900/60 p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                    l.status === 'applied' ? 'text-emerald-400 bg-emerald-500/10' :
                    l.status === 'proposed' ? 'text-amber-400 bg-amber-500/10' :
                    l.status === 'retired' ? 'text-zinc-500 bg-zinc-800' :
                    'text-zinc-500 bg-zinc-900'
                  }`}>{l.status}</span>
                  <span className="text-xs text-zinc-200 font-medium">{l.title}</span>
                </div>
                {l.rationale && (
                  <p className="text-[11px] text-zinc-500 italic">{l.rationale}</p>
                )}
                <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap bg-zinc-950/60 p-2 rounded border border-zinc-800 font-sans">
                  {l.content}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      {!inFlight && learnings.length === 0 && swarm.simulations.length > 0 && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-500">
          All personas ran — the reviewer didn&apos;t flag anything worth changing.
          Your agent handled the full spectrum well.
        </section>
      )}
    </div>
  )
}
