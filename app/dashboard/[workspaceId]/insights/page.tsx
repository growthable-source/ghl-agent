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
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Insights</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            At-risk contacts and knowledge gaps — derived from the last 14 days.
          </p>
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 p-1 rounded-xl mb-6 w-fit"
          style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
        >
          <button
            onClick={() => setTab('health')}
            className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            style={
              tab === 'health'
                ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            Contact Health ({health.length})
          </button>
          <button
            onClick={() => setTab('gaps')}
            className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            style={
              tab === 'gaps'
                ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                : { color: 'var(--text-secondary)' }
            }
          >
            Knowledge Gaps ({gaps.length})
          </button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="h-20 rounded-xl animate-pulse"
                style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
              />
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
                  className="block p-4 rounded-xl transition-colors"
                  style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center gap-3">
                    {/* Risk score gauge */}
                    <div className="flex-shrink-0 relative w-12 h-12">
                      <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                        <circle cx="18" cy="18" r="14" fill="none" stroke="var(--border-secondary)" strokeWidth="3" />
                        <circle
                          cx="18" cy="18" r="14" fill="none"
                          stroke={h.risk === 'high' ? 'var(--accent-red)' : h.risk === 'medium' ? 'var(--accent-amber)' : 'var(--accent-emerald)'}
                          strokeWidth="3"
                          strokeDasharray={`${(h.score / 100) * 88} 88`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <span
                        className="absolute inset-0 flex items-center justify-center text-xs font-bold"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {h.score}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-sm font-semibold font-mono" style={{ color: 'var(--text-primary)' }}>
                          {h.contactId.slice(-12)}
                        </span>
                        {h.agent && (
                          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>· {h.agent.name}</span>
                        )}
                        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                          {h.hoursIdle}h idle · {h.messageCount} messages
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {h.reasons.map((r, i) => (
                          <span
                            key={i}
                            className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={{
                              background:
                                h.risk === 'high'
                                  ? 'var(--accent-red-bg)'
                                  : h.risk === 'medium'
                                  ? 'var(--accent-amber-bg)'
                                  : 'var(--surface-tertiary)',
                              color:
                                h.risk === 'high'
                                  ? 'var(--accent-red)'
                                  : h.risk === 'medium'
                                  ? 'var(--accent-amber)'
                                  : 'var(--text-tertiary)',
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
                  <div
                    key={i}
                    className="p-4 rounded-xl"
                    style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>&ldquo;{gap.theme}&rdquo;</span>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
                      >
                        {gap.count} times
                      </span>
                      {gap.agentCount > 1 && (
                        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                          across {gap.agentCount} agents
                        </span>
                      )}
                      <Link
                        href={`/dashboard/${workspaceId}/agents`}
                        className="ml-auto text-xs font-medium hover:underline"
                        style={{ color: 'var(--accent-primary)' }}
                      >
                        Add knowledge →
                      </Link>
                    </div>
                    <div className="space-y-1">
                      {gap.examples.map((ex, j) => (
                        <p
                          key={j}
                          className="text-xs italic pl-3"
                          style={{ color: 'var(--text-tertiary)', borderLeft: '1px solid var(--border)' }}
                        >
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
    <div
      className="p-4 rounded-xl"
      style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
    >
      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 rounded-xl"
      style={{
        border: '1px dashed var(--border-secondary)',
        background: 'var(--surface-secondary)',
      }}
    >
      <div
        className="w-12 h-12 mb-3 rounded-full flex items-center justify-center text-2xl"
        style={{ background: 'var(--surface-tertiary)' }}
      >
        {icon}
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{subtitle}</p>
    </div>
  )
}
