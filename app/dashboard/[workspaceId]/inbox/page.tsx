'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Row {
  id: string
  widget: { id: string; name: string; primaryColor?: string }
  visitor: { id: string; name: string | null; email: string | null; cookieId: string }
  status: string
  messageCount: number
  csatRating: number | null
  lastMessageAt: string
  lastMessage: { role: string; content: string; kind?: string; createdAt: string } | null
}

type FilterTab = 'live' | 'handed_off' | 'ended' | 'all'

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function isHot(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000
}

export default function InboxPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [tab, setTab] = useState<FilterTab>('live')
  const [search, setSearch] = useState('')

  const fetchRows = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations`)
    const data = await res.json()
    setRows(data.conversations || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchRows() }, [fetchRows])
  useEffect(() => {
    const i = setInterval(fetchRows, 8000)
    return () => clearInterval(i)
  }, [fetchRows])

  const counts = useMemo(() => ({
    live: rows.filter(r => r.status === 'active').length,
    handed_off: rows.filter(r => r.status === 'handed_off').length,
    ended: rows.filter(r => r.status === 'ended').length,
    all: rows.length,
  }), [rows])

  const filtered = useMemo(() => {
    let f = rows
    if (tab === 'live') f = f.filter(r => r.status === 'active')
    else if (tab === 'handed_off') f = f.filter(r => r.status === 'handed_off')
    else if (tab === 'ended') f = f.filter(r => r.status === 'ended')
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      f = f.filter(r =>
        (r.visitor.name || '').toLowerCase().includes(q)
        || (r.visitor.email || '').toLowerCase().includes(q)
        || (r.lastMessage?.content || '').toLowerCase().includes(q)
        || r.widget.name.toLowerCase().includes(q),
      )
    }
    return f
  }, [rows, tab, search])

  if (loading) return (
    <div className="flex-1 p-8">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="h-16 bg-zinc-900/40 rounded-xl border border-zinc-800 animate-pulse" />
        <div className="h-16 bg-zinc-900/40 rounded-xl border border-zinc-800 animate-pulse" />
      </div>
    </div>
  )

  const hot = rows.filter(r => isHot(r.lastMessageAt) && r.status !== 'ended').length

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              Inbox
              {hot > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {hot} active now
                </span>
              )}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">Live chat conversations across every widget in this workspace.</p>
          </div>
          <div className="text-[11px] text-zinc-500">Auto-refreshes every 8s · {rows.length} total</div>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300">Run manual_widget_migration.sql to enable the inbox.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {([
            { id: 'live', label: 'Live' },
            { id: 'handed_off', label: 'Handed off' },
            { id: 'ended', label: 'Ended' },
            { id: 'all', label: 'All' },
          ] as Array<{ id: FilterTab; label: string }>).map(t => {
            const active = tab === t.id
            const count = counts[t.id]
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  active
                    ? 'bg-white text-black'
                    : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 ${active ? 'text-zinc-500' : 'text-zinc-600'}`}>{count}</span>
              </button>
            )
          })}
          <div className="ml-auto relative">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, email, message…"
              className="w-72 max-w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">📥</div>
            <p className="text-sm font-medium text-white mb-1">
              {search.trim() ? 'No matches' : tab === 'live' ? 'Nothing live right now' : 'No conversations'}
            </p>
            <p className="text-xs text-zinc-500">
              {search.trim() ? 'Try a different query.' : 'Conversations land here as visitors chat with your widgets.'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden bg-zinc-950">
            {filtered.map(r => {
              const visitorLabel = r.visitor.name || r.visitor.email || `Visitor ${r.visitor.cookieId.slice(-6)}`
              const initial = (r.visitor.name || r.visitor.email || 'V').charAt(0).toUpperCase()
              const accent = r.widget.primaryColor || '#fa4d2e'
              const hot = isHot(r.lastMessageAt) && r.status !== 'ended'
              const lastKind = r.lastMessage?.kind
              return (
                <Link
                  key={r.id}
                  href={`/dashboard/${workspaceId}/inbox/${r.id}`}
                  className="flex items-start gap-3 p-4 hover:bg-zinc-900/60 transition-colors"
                >
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white"
                      style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
                      {initial}
                    </div>
                    {hot && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-semibold text-white truncate">{visitorLabel}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{r.widget.name}</span>
                      {r.status === 'active' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">live</span>
                      )}
                      {r.status === 'handed_off' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">taken over</span>
                      )}
                      {r.status === 'ended' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">ended</span>
                      )}
                      {typeof r.csatRating === 'number' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 inline-flex items-center gap-0.5">
                          ⭐ {r.csatRating}/5
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-500 whitespace-nowrap">{timeAgo(r.lastMessageAt)}</span>
                    </div>
                    {r.lastMessage && (
                      <p className="text-xs text-zinc-400 truncate">
                        <span className="text-zinc-600">
                          {r.lastMessage.role === 'visitor' ? '👤' : r.lastMessage.role === 'agent' ? '🤖' : 'ℹ️'}
                        </span>{' '}
                        {lastKind === 'image' ? <span className="text-zinc-500 italic">sent an image</span>
                          : lastKind === 'file' ? <span className="text-zinc-500 italic">sent a file</span>
                          : r.lastMessage.content}
                      </p>
                    )}
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      {r.messageCount} message{r.messageCount === 1 ? '' : 's'}
                      {r.visitor.email && <> · {r.visitor.email}</>}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
