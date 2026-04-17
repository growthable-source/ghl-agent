'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface ContactHealth {
  contactId: string
  conversationId: string | null
  agent: { id: string; name: string } | null
  messageCount: number
  hoursIdle: number
  score: number
  risk: 'high' | 'medium' | 'low'
  reasons: string[]
  lastActive: string
}

interface KnowledgeGap {
  theme: string
  count: number
  examples: string[]
  agentCount: number
}

export default function InsightsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [health, setHealth] = useState<ContactHealth[]>([])
  const [gaps, setGaps] = useState<KnowledgeGap[]>([])
  const [stats, setStats] = useState<{ totalFallbacks: number; totalMessagesAnalyzed: number; fallbackRate: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'health' | 'gaps'>('health')

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/insights`)
      .then(r => r.json())
      .then(data => {
        setHealth(data.contactHealth || [])
        setGaps(data.knowledgeGaps || [])
        setStats(data.stats || null)
      })
      .finally(() => setLoading(false))
  }, [workspaceId])

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Insights</h1>
          <p className="text-sm text-zinc-400 mt-1">
            At-risk contacts and knowledge gaps — derived from the last 14 days.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-zinc-900/60 border border-zinc-800 mb-6 w-fit">
          <button
            onClick={() => setTab('health')}
            className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
              tab === 'health' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            style={tab === 'health' ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
          >
            Contact Health ({health.length})
          </button>
          <button
            onClick={() => setTab('gaps')}
            className={`text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
              tab === 'gaps' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
            style={tab === 'gaps' ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
          >
            Knowledge Gaps ({gaps.length})
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-zinc-900/40 border border-zinc-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : tab === 'health' ? (
          health.length === 0 ? (
            <EmptyState icon="♥" title="All contacts healthy" subtitle="No at-risk conversations right now." />
          ) : (
            <div className="space-y-2">
              {health.map(h => (
                <Link
                  key={h.contactId}
                  href={`/dashboard/${workspaceId}/contacts/${h.contactId}`}
                  className="block p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {/* Risk score gauge */}
                    <div className="flex-shrink-0 relative w-12 h-12">
                      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="14" fill="none" stroke="#27272a" strokeWidth="3" />
                        <circle
                          cx="18" cy="18" r="14" fill="none"
                          stroke={h.risk === 'high' ? '#ef4444' : h.risk === 'medium' ? '#f59e0b' : '#22c55e'}
                          strokeWidth="3"
                          strokeDasharray={`${(h.score / 100) * 88} 88`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                        {h.score}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-semibold text-white font-mono">
                          {h.contactId.slice(-12)}
                        </span>
                        {h.agent && (
                          <span className="text-xs text-zinc-400">· {h.agent.name}</span>
                        )}
                        <span className="ml-auto text-[10px] text-zinc-500">
                          {h.hoursIdle}h idle · {h.messageCount} messages
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {h.reasons.map((r, i) => (
                          <span
                            key={i}
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{
                              background: h.risk === 'high' ? 'rgba(239,68,68,0.1)' : h.risk === 'medium' ? 'rgba(245,158,11,0.1)' : 'rgba(113,113,122,0.1)',
                              color: h.risk === 'high' ? '#f87171' : h.risk === 'medium' ? '#fbbf24' : '#a1a1aa',
                            }}
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )
        ) : (
          /* Knowledge gaps tab */
          <>
            {stats && (
              <div className="grid grid-cols-3 gap-3 mb-6">
                <Tile label="Fallback rate" value={`${stats.fallbackRate}%`} />
                <Tile label="Times flagged" value={stats.totalFallbacks} />
                <Tile label="Messages analyzed" value={stats.totalMessagesAnalyzed} />
              </div>
            )}
            {gaps.length === 0 ? (
              <EmptyState icon="📚" title="No knowledge gaps detected" subtitle="Agents aren't using fallback language frequently." />
            ) : (
              <div className="space-y-2">
                {gaps.map((gap, i) => (
                  <div key={i} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-white capitalize">&ldquo;{gap.theme}&rdquo;</span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: 'rgba(245,158,11,0.1)', color: '#fbbf24' }}
                      >
                        {gap.count} times
                      </span>
                      {gap.agentCount > 1 && (
                        <span className="text-[10px] text-zinc-500">
                          across {gap.agentCount} agents
                        </span>
                      )}
                      <Link
                        href={`/dashboard/${workspaceId}/agents`}
                        className="ml-auto text-xs font-medium hover:underline"
                        style={{ color: '#fa4d2e' }}
                      >
                        Add knowledge →
                      </Link>
                    </div>
                    <div className="space-y-1">
                      {gap.examples.map((ex, j) => (
                        <p key={j} className="text-xs text-zinc-500 italic pl-3 border-l border-zinc-800">
                          &ldquo;{ex}&rdquo;
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  )
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
      <div className="w-12 h-12 mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">{icon}</div>
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="text-xs text-zinc-500 mt-1">{subtitle}</p>
    </div>
  )
}
