import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const ALL_CHANNELS = ['SMS', 'WhatsApp', 'Email', 'FB', 'IG', 'GMB', 'Live_Chat']

/**
 * Admin-only routing diagnostic. Previously lived at
 * /dashboard/[workspaceId]/routing-diagnostic where it was customer-
 * facing. Moved here because (a) it's a support/debugging tool, not
 * customer UX, and (b) the cross-workspace surface it presented had
 * tenant-isolation risk that's easier to eliminate than to police.
 *
 * Server-rendered so per-request data never hits a shared cache.
 */
export default async function AdminRoutingDiagnosticPage({ params }: Params) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) redirect('/admin/login')

  const { id: workspaceId } = await params

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, slug: true },
  })
  if (!workspace) redirect('/admin/workspaces')

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)

  const agents = locationIds.length === 0 ? [] : await db.agent.findMany({
    where: {
      OR: [
        { workspaceId },
        { locationId: { in: locationIds } },
      ],
      isActive: true,
    },
    include: {
      channelDeployments: true,
      routingRules: { orderBy: { priority: 'asc' } },
    },
  })

  const recent = locationIds.length === 0 ? [] : await db.messageLog.findMany({
    where: { locationId: { in: locationIds } },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  const skippedRecently = recent.filter(r => r.status === 'SKIPPED').length

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <div>
        <Link href={`/admin/workspaces/${workspaceId}`} className="text-xs text-zinc-500 hover:text-white">
          ← {workspace.name}
        </Link>
        <h1 className="text-xl font-semibold mt-2">Routing diagnostic</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Why did a given inbound route (or not) for this workspace?
        </p>
      </div>

      {locationIds.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
          This workspace has no locations connected — nothing to diagnose.
        </div>
      )}

      {locationIds.length > 0 && (
        <>
          {/* Summary chips */}
          <section className="grid grid-cols-3 gap-3">
            <Stat label="Active agents" value={agents.length} />
            <Stat label="Last 20 skipped" value={skippedRecently} tone={skippedRecently >= 3 ? 'warn' : 'muted'} />
            <Stat label="Locations" value={locationIds.length} />
          </section>

          {/* Agents */}
          <section>
            <h2 className="text-sm font-medium text-zinc-200 mb-3">Agents ({agents.length})</h2>
            <div className="space-y-2">
              {agents.map(agent => {
                const deployments = (agent as any).channelDeployments as { channel: string; isActive: boolean }[]
                const hasActiveDeployment = deployments.some(d => d.isActive)
                const hasAnyRule = agent.routingRules.length > 0
                const issues: string[] = []
                if (deployments.length === 0) {
                  issues.push('No channel deployments configured (backward-compat: responds to all channels).')
                } else if (!hasActiveDeployment) {
                  issues.push('All channel deployments are OFF — agent can never match.')
                }
                if (!hasAnyRule) {
                  issues.push('No routing rules — agent will NEVER be selected.')
                }
                return (
                  <div key={agent.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm text-zinc-200">{agent.name}</p>
                        <p className="text-[10px] text-zinc-600 font-mono">{agent.id}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {ALL_CHANNELS.map(ch => {
                          const d = deployments.find(x => x.channel === ch)
                          const on = d?.isActive
                          const inactive = d && !d.isActive
                          return (
                            <span
                              key={ch}
                              className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                on ? 'bg-emerald-500/10 text-emerald-400' :
                                inactive ? 'bg-zinc-800 text-zinc-500 line-through' :
                                'bg-zinc-900 text-zinc-600'
                              }`}
                            >
                              {ch}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                    {agent.routingRules.length > 0 && (
                      <div className="mt-3 text-[11px] text-zinc-500 space-y-0.5">
                        {agent.routingRules.map(r => (
                          <div key={r.id} className="font-mono">
                            priority {r.priority} · {r.ruleType}{r.value ? `: ${r.value}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                    {issues.length > 0 && (
                      <div className="mt-2 text-[11px] text-amber-400 space-y-0.5">
                        {issues.map((s, i) => <div key={i}>⚠ {s}</div>)}
                      </div>
                    )}
                  </div>
                )
              })}
              {agents.length === 0 && (
                <div className="text-sm text-zinc-500 p-4 text-center">No active agents.</div>
              )}
            </div>
          </section>

          {/* Recent inbounds */}
          <section>
            <h2 className="text-sm font-medium text-zinc-200 mb-3">Last 20 inbounds</h2>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
              {recent.map(log => (
                <div key={log.id} className="p-3 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                      log.status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-400' :
                      log.status === 'SKIPPED' ? 'bg-amber-500/10 text-amber-400' :
                      log.status === 'ERROR' ? 'bg-red-500/10 text-red-400' :
                      'bg-zinc-800 text-zinc-500'
                    }`}>{log.status}</span>
                    <span className="text-zinc-300">
                      {log.agent ? log.agent.name : <em className="text-zinc-600">no agent matched</em>}
                    </span>
                    <span className="text-zinc-600 font-mono">ct {log.contactId.slice(-8)}</span>
                    <span className="ml-auto text-zinc-600 font-mono">
                      {log.createdAt.toISOString().slice(0, 19).replace('T', ' ')}
                    </span>
                  </div>
                  {log.inboundMessage && (
                    <p className="text-zinc-500 mt-1 truncate">
                      &ldquo;{log.inboundMessage.slice(0, 140)}&rdquo;
                    </p>
                  )}
                  {log.errorMessage && (
                    <p className="text-amber-300 mt-1">→ {log.errorMessage}</p>
                  )}
                </div>
              ))}
              {recent.length === 0 && (
                <div className="p-4 text-center text-zinc-500">No inbound messages yet.</div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'muted' }: { label: string; value: number | string; tone?: 'muted' | 'warn' }) {
  const tint = tone === 'warn' ? 'border-amber-500/40 bg-amber-500/[0.05]' : 'border-zinc-800 bg-zinc-950'
  return (
    <div className={`rounded-lg border p-3 ${tint}`}>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="text-xl font-semibold text-zinc-100 mt-1">{value}</p>
    </div>
  )
}
