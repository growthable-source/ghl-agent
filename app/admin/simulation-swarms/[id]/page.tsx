import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export default async function SwarmDetail({ params }: Params) {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')
  const { id } = await params

  const swarm = await db.simulationSwarm.findUnique({
    where: { id },
    include: {
      simulations: {
        orderBy: { createdAt: 'asc' },
        include: { agent: { select: { name: true } } },
      },
    },
  })
  if (!swarm) notFound()

  const personas = Array.isArray(swarm.personaProfiles) ? swarm.personaProfiles as any[] : []
  const done = swarm.totalComplete + swarm.totalFailed
  const pct = swarm.totalPlanned > 0 ? Math.round((done / swarm.totalPlanned) * 100) : 0

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <div>
        <Link href="/admin/simulation-swarms" className="text-xs text-zinc-500 hover:text-white">
          ← Swarms
        </Link>
        <h1 className="text-xl font-semibold mt-2">{swarm.name}</h1>
        <p className="text-xs text-zinc-500 mt-1 font-mono">
          {swarm.createdByEmail} · {swarm.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
        </p>
      </div>

      {/* Progress */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-200">
            Progress: {done}/{swarm.totalPlanned}
            <span className="text-zinc-500 ml-2 text-xs">({pct}%)</span>
          </h2>
          <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
            swarm.status === 'complete' ? 'bg-emerald-500/10 text-emerald-400' :
            swarm.status === 'running' ? 'bg-blue-500/10 text-blue-400' :
            'bg-zinc-800 text-zinc-400'
          }`}>{swarm.status}</span>
        </div>
        <div className="w-full h-2 bg-zinc-900 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-[11px] text-zinc-500">
          Processor picks up one queued sim per minute. Refresh to see new completions land.
        </p>
      </section>

      {/* Personas */}
      <section>
        <h2 className="text-sm font-medium text-zinc-200 mb-3">Personas ({personas.length})</h2>
        <div className="space-y-2">
          {personas.map((p, i) => (
            <div key={i} className="rounded border border-zinc-800 bg-zinc-950 p-3 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">{p.style ?? '—'}</span>
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">{p.channel ?? '—'}</span>
                {p.goal && <span className="text-zinc-400">→ {p.goal}</span>}
              </div>
              <p className="text-zinc-400 whitespace-pre-wrap">{p.context}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Sims */}
      <section>
        <h2 className="text-sm font-medium text-zinc-200 mb-3">Simulations ({swarm.simulations.length})</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
          <table className="w-full text-xs">
            <thead className="text-zinc-500 text-[10px] uppercase tracking-wider">
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-2 font-semibold">Agent</th>
                <th className="text-left px-4 py-2 font-semibold">Persona</th>
                <th className="text-left px-4 py-2 font-semibold">Status</th>
                <th className="text-left px-4 py-2 font-semibold">Turns</th>
                <th className="text-left px-4 py-2 font-semibold">Learnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {swarm.simulations.map(s => (
                <tr key={s.id} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-2.5">
                    {s.workspaceId ? (
                      <Link href={`/dashboard/${s.workspaceId}/simulations/${s.id}`} className="text-zinc-200 hover:text-white">
                        {s.agent?.name ?? s.agentId}
                      </Link>
                    ) : (
                      <span className="text-zinc-200">{s.agent?.name ?? s.agentId}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">
                    <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-2">{s.style.replace(/_/g, ' ')}</span>
                    {s.channel}
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
                </tr>
              ))}
              {swarm.simulations.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                    Nothing queued — this shouldn&apos;t happen.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
