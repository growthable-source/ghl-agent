'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface AttentionItem {
  type: 'paused' | 'error' | 'fallback' | 'stalled'
  severity: 'high' | 'medium' | 'low'
  label: string
  reason: string
  contactId: string
  conversationId: string | null
  agent: { id: string; name: string } | null
  at: string
  messageCount?: number
  lastMessage?: string
  lastReply?: string
}

const SEVERITY: Record<string, { color: string; bg: string; dot: string }> = {
  high:   { color: '#f87171', bg: 'rgba(248,113,113,0.08)', dot: '#ef4444' },
  medium: { color: '#fbbf24', bg: 'rgba(251,191,36,0.08)',  dot: '#f59e0b' },
  low:    { color: '#a1a1aa', bg: 'rgba(161,161,170,0.08)', dot: '#71717a' },
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NeedsAttentionPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [items, setItems] = useState<AttentionItem[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/needs-attention`)
      const data = await res.json()
      setItems(data.items || [])
      setSummary(data.summary)
    } finally { setLoading(false) }
  }, [workspaceId])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    const i = setInterval(fetchData, 30000)
    return () => clearInterval(i)
  }, [fetchData])

  const filtered = filter === 'all' ? items : items.filter(i => i.type === filter)

  if (loading) {
    return <div className="flex-1 p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Needs Attention</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Conversations where your agents stopped, errored, or asked for help.
          </p>
        </div>

        {/* Summary chips */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { key: 'paused',    label: 'Paused',       count: summary?.paused ?? 0,    sev: 'high' as const },
            { key: 'error',     label: 'Errors',       count: summary?.errors ?? 0,    sev: 'high' as const },
            { key: 'fallback',  label: "Couldn't answer", count: summary?.fallbacks ?? 0, sev: 'medium' as const },
            { key: 'stalled',   label: 'Stalled',      count: summary?.stalled ?? 0,   sev: 'low' as const },
          ].map(s => (
            <button
              key={s.key}
              onClick={() => setFilter(filter === s.key ? 'all' : s.key)}
              className={`p-4 rounded-xl border text-left transition-colors ${
                filter === s.key
                  ? 'border-zinc-600 bg-zinc-900'
                  : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: SEVERITY[s.sev].dot }} />
                <span className="text-xs text-zinc-500">{s.label}</span>
              </div>
              <p className="text-xl font-bold text-white">{s.count}</p>
            </button>
          ))}
        </div>

        {/* Items */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-12 h-12 mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-white">All clear</p>
            <p className="text-xs text-zinc-500 mt-1">No conversations need your attention right now.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((item, i) => {
              const sev = SEVERITY[item.severity]
              return (
                <div
                  key={`${item.contactId}-${i}`}
                  className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ background: sev.dot }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{ color: sev.color, background: sev.bg }}
                        >
                          {item.label}
                        </span>
                        {item.agent && (
                          <Link
                            href={`/dashboard/${workspaceId}/agents/${item.agent.id}`}
                            className="text-xs font-medium text-zinc-300 hover:text-white"
                          >
                            {item.agent.name}
                          </Link>
                        )}
                        <span className="ml-auto text-xs text-zinc-500">{timeAgo(item.at)}</span>
                      </div>
                      <p className="text-sm text-zinc-300 mb-1">{item.reason}</p>
                      {item.lastMessage && (
                        <p className="text-xs text-zinc-500 italic truncate">
                          Last from contact: &ldquo;{item.lastMessage}&rdquo;
                        </p>
                      )}
                      {item.messageCount !== undefined && (
                        <p className="text-xs text-zinc-500">{item.messageCount} messages exchanged</p>
                      )}
                    </div>
                    <Link
                      href={`/dashboard/${workspaceId}/contacts/${item.contactId}`}
                      className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
                    >
                      Take over
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-xs text-zinc-600 text-center mt-8">Auto-refreshing every 30 seconds</p>
      </div>
    </div>
  )
}
