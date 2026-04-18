'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

export default function RoutingDiagnosticPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/routing-diagnostic`)
      setData(await res.json())
    } finally { setLoading(false) }
  }

  useEffect(() => { refresh() }, [workspaceId])

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Routing Diagnostic</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Why are inbound messages being skipped? This page shows you which agents are eligible
              for which channels, and explains recent inbound routing decisions.
            </p>
          </div>
          <button
            onClick={refresh}
            className="text-xs font-medium px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Workspace-level verdict */}
        {data?.workspaceIssues?.length > 0 && (
          <div className="p-4 mb-6 rounded-xl border border-red-500/40 bg-red-500/5">
            <p className="text-sm font-semibold text-red-400 mb-2">✗ Routing problems detected</p>
            <ul className="space-y-1">
              {data.workspaceIssues.map((issue: string, i: number) => (
                <li key={i} className="text-xs text-red-300">• {issue}</li>
              ))}
            </ul>
          </div>
        )}
        {data?.ok && (
          <div className="p-4 mb-6 rounded-xl border border-emerald-500/40 bg-emerald-500/5">
            <p className="text-sm font-semibold text-emerald-400">✓ Routing looks healthy</p>
          </div>
        )}

        {/* Recent inbounds */}
        {data?.recent?.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Last 10 inbound messages
            </h2>
            <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
              {data.recent.map((log: any) => {
                const isSkipped = log.status === 'SKIPPED'
                const isError = log.status === 'ERROR'
                const isSuccess = log.status === 'SUCCESS'
                return (
                  <div key={log.id} className="p-3 flex items-start gap-3 bg-zinc-900/40 hover:bg-zinc-900/80 transition-colors">
                    <span className={`text-sm flex-shrink-0 mt-0.5 ${
                      isSkipped ? 'text-amber-400'
                      : isError ? 'text-red-400'
                      : isSuccess ? 'text-emerald-400'
                      : 'text-zinc-500'
                    }`}>
                      {isSkipped ? '⊘' : isError ? '⚠' : isSuccess ? '✓' : '⋯'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          isSkipped ? 'bg-amber-500/10 text-amber-400'
                          : isError ? 'bg-red-500/10 text-red-400'
                          : 'bg-emerald-500/10 text-emerald-400'
                        }`}>{log.status}</span>
                        <span className="text-xs text-zinc-300">
                          {log.agent ? log.agent.name : <span className="italic text-zinc-500">no agent matched</span>}
                        </span>
                        <span className="text-[10px] text-zinc-600 font-mono">{log.contactId.slice(-8)}</span>
                        <span className="ml-auto text-[10px] text-zinc-500">
                          {new Date(log.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </span>
                      </div>
                      {log.inboundPreview && (
                        <p className="text-xs text-zinc-500 italic mt-0.5 truncate">&ldquo;{log.inboundPreview}&rdquo;</p>
                      )}
                      {log.errorMessage && (
                        <p className="text-[11px] text-amber-300 mt-0.5">→ {log.errorMessage}</p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Agents */}
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          Agents ({data?.agents?.length || 0})
        </h2>
        {data?.agents?.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <p className="text-sm text-zinc-400">No active agents — create one to handle inbound messages.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data?.agents?.map((agent: any) => {
              const hasIssues = agent.issues.length > 0
              return (
                <div key={agent.id} className={`rounded-xl border p-4 ${
                  hasIssues ? 'border-amber-500/30 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900/40'
                }`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{agent.name}</p>
                      <p className="text-[10px] text-zinc-500 font-mono">{agent.id.slice(-12)}</p>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/dashboard/${workspaceId}/agents/${agent.id}/deploy`}
                        className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
                      >
                        Channels
                      </Link>
                      <Link
                        href={`/dashboard/${workspaceId}/agents/${agent.id}/rules`}
                        className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
                      >
                        Rules
                      </Link>
                    </div>
                  </div>

                  {/* Channel matrix */}
                  <div className="mb-3">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Channel deployments</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(agent.channelMatrix).map(([ch, state]: any) => {
                        const eligible = state.deployed && state.isActive
                        return (
                          <span key={ch}
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={
                              eligible
                                ? { background: 'rgba(34,197,94,0.1)', color: '#22c55e' }
                                : state.deployed
                                ? { background: 'rgba(239,68,68,0.1)', color: '#f87171' }
                                : { background: 'rgba(113,113,122,0.1)', color: '#71717a' }
                            }
                            title={eligible ? 'Active' : state.deployed ? 'Deployed but paused' : 'Not deployed'}
                          >
                            {ch}{!eligible && state.deployed ? ' (paused)' : !state.deployed ? ' (off)' : ''}
                          </span>
                        )
                      })}
                    </div>
                    {agent.deployments.length === 0 && (
                      <p className="text-[10px] text-zinc-500 italic mt-1">No deployments — agent responds to ALL channels by default.</p>
                    )}
                  </div>

                  {/* Routing rules */}
                  <div className="mb-3">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Routing rules</p>
                    {agent.routingRules.length === 0 ? (
                      <p className="text-xs text-red-400">No rules — this agent will never be selected.</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {agent.routingRules.map((r: any, i: number) => (
                          <span key={i} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
                            {r.ruleType}{r.value ? ` = ${r.value}` : ''} (prio {r.priority})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Issues */}
                  {agent.issues.length > 0 && (
                    <div className="pt-3 border-t border-zinc-800/60">
                      <p className="text-[10px] text-amber-400 uppercase tracking-wider font-semibold mb-1">Issues</p>
                      <ul className="space-y-0.5">
                        {agent.issues.map((issue: string, i: number) => (
                          <li key={i} className="text-[11px] text-amber-300">→ {issue}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
