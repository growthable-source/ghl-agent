'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface AgentDigest {
  id: string
  name: string
  messages: number
  errors: number
  appointments: number
  toolCalls: number
  tokens: number
  followUpsSent: number
  uniqueContactsReached: number
  fallbackCount: number
  estCost: number
}

interface Totals {
  messages: number
  appointments: number
  followUpsSent: number
  newConversations: number
  tokens: number
  estCost: number
  deltaVsLastWeek: number | null
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function DigestPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [agents, setAgents] = useState<AgentDigest[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [weekStart, setWeekStart] = useState<string>('')
  const [weekEnd, setWeekEnd] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/digest`)
      .then(r => r.json())
      .then(data => {
        setAgents(data.agents || [])
        setTotals(data.totals)
        setWeekStart(data.weekStart)
        setWeekEnd(data.weekEnd)
      })
      .finally(() => setLoading(false))
  }, [workspaceId])

  if (loading) {
    return <div className="flex-1 p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
            <span>📊 Weekly digest</span>
            <span>·</span>
            <span>{weekStart && fmtDate(weekStart)} — {weekEnd && fmtDate(weekEnd)}</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Your agents this week</h1>
        </div>

        {/* Headline totals */}
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
            <TotalCard label="Messages" value={totals.messages} delta={totals.deltaVsLastWeek} />
            <TotalCard label="Appointments" value={totals.appointments} />
            <TotalCard label="Follow-ups sent" value={totals.followUpsSent} />
            <TotalCard label="New conversations" value={totals.newConversations} />
            <TotalCard label="Est. API cost" value={`$${totals.estCost.toFixed(2)}`} sub={`${(totals.tokens / 1000).toFixed(0)}k tokens`} />
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-4">Agent performance</h2>

          {agents.length === 0 ? (
            <div className="text-center py-12 text-sm text-zinc-500">No agent activity this week</div>
          ) : (
            <div className="space-y-2">
              {agents.map((a, idx) => {
                const errorRate = a.messages > 0 ? Math.round((a.errors / a.messages) * 100) : 0
                const fallbackRate = a.messages > 0 ? Math.round((a.fallbackCount / a.messages) * 100) : 0
                return (
                  <Link
                    key={a.id}
                    href={`/dashboard/${workspaceId}/agents/${a.id}`}
                    className="block p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-center gap-4 mb-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-400">
                        #{idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white">{a.name}</p>
                        <p className="text-xs text-zinc-500">
                          {a.uniqueContactsReached} contacts · {a.messages} messages · {a.toolCalls} actions
                        </p>
                      </div>
                      {(errorRate > 5 || fallbackRate > 10) && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}
                        >
                          Needs attention
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
                      <MiniStat label="Messages" value={a.messages} />
                      <MiniStat label="Appointments" value={a.appointments} highlight />
                      <MiniStat label="Follow-ups" value={a.followUpsSent} />
                      <MiniStat label="Tool calls" value={a.toolCalls} />
                      <MiniStat label="Errors" value={a.errors} warning={a.errors > 0} />
                      <MiniStat label="Est. cost" value={`$${a.estCost.toFixed(2)}`} />
                    </div>

                    {(a.fallbackCount > 0) && (
                      <p className="text-[11px] text-amber-400 mt-3 pt-3 border-t border-zinc-800">
                        Said &ldquo;I don&apos;t know&rdquo; {a.fallbackCount} times · <Link href={`/dashboard/${workspaceId}/insights`} className="hover:underline font-medium">Review knowledge gaps →</Link>
                      </p>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Call to action */}
        <div className="mt-12 p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 text-center">
          <p className="text-sm text-zinc-300">
            <span className="font-semibold">📬 Want this in your inbox every Monday?</span>
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            Email digests coming soon. For now, bookmark this page or check in each Monday.
          </p>
        </div>
      </div>
    </div>
  )
}

function TotalCard({ label, value, sub, delta }: { label: string; value: string | number; sub?: string; delta?: number | null }) {
  return (
    <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold text-white">{value}</p>
        {delta !== null && delta !== undefined && (
          <span className={`text-[11px] font-medium ${delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {delta >= 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
      {sub && <p className="text-[10px] text-zinc-500 mt-1">{sub}</p>}
    </div>
  )
}

function MiniStat({ label, value, highlight, warning }: { label: string; value: string | number; highlight?: boolean; warning?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500 mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${
        highlight ? 'text-emerald-400' : warning ? 'text-red-400' : 'text-white'
      }`}>
        {value}
      </p>
    </div>
  )
}
