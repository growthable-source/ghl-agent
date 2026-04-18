'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Widget {
  id: string
  name: string
  publicKey: string
  primaryColor: string
  isActive: boolean
  voiceEnabled: boolean
  allowedDomains: string[]
  _count: { conversations: number; visitors: number }
  createdAt: string
}

export default function WidgetsPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [widgets, setWidgets] = useState<Widget[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [notMigrated, setNotMigrated] = useState(false)

  const fetchWidgets = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/widgets`)
    const data = await res.json()
    setWidgets(data.widgets || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchWidgets() }, [fetchWidgets])

  async function createWidget() {
    setCreating(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Widget' }),
      })
      const data = await res.json()
      if (data.widget) {
        router.push(`/dashboard/${workspaceId}/widgets/${data.widget.id}`)
      }
    } finally { setCreating(false) }
  }

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Chat Widgets</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Embed a chat widget on any website. Visitors talk to your agents in real time — no CRM required.
            </p>
          </div>
          <button
            onClick={createWidget}
            disabled={creating}
            className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
            style={{ background: '#fa4d2e' }}
          >
            {creating ? 'Creating…' : '+ New widget'}
          </button>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300">Run manual_widget_migration.sql to enable widgets.</p>
          </div>
        )}

        {widgets.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">💬</div>
            <p className="text-sm font-medium text-white mb-1">No widgets yet</p>
            <p className="text-xs text-zinc-500 mb-4 max-w-sm mx-auto">
              Create a widget, paste the install snippet on your site, and start capturing conversations.
            </p>
            <button onClick={createWidget} disabled={creating}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#fa4d2e' }}>
              {creating ? 'Creating…' : 'Create first widget'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {widgets.map(w => (
              <Link
                key={w.id}
                href={`/dashboard/${workspaceId}/widgets/${w.id}`}
                className="relative p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 transition-colors"
              >
                <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl" style={{ background: w.isActive ? w.primaryColor : '#3f3f46' }} />
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white"
                    style={{ background: w.primaryColor }}>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  {!w.isActive && (
                    <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800">paused</span>
                  )}
                </div>
                <p className="text-sm font-semibold text-white mb-1">{w.name}</p>
                <p className="text-[11px] text-zinc-500 truncate">
                  {w.allowedDomains.length > 0 ? w.allowedDomains.join(', ') : 'any domain'}
                </p>
                <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-zinc-800">
                  <div>
                    <p className="text-lg font-bold text-white">{w._count.visitors}</p>
                    <p className="text-[10px] text-zinc-500">Visitors</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-white">{w._count.conversations}</p>
                    <p className="text-[10px] text-zinc-500">Conversations</p>
                  </div>
                </div>
                {w.voiceEnabled && (
                  <span className="absolute bottom-3 right-3 text-[10px] font-medium text-purple-400 px-1.5 py-0.5 rounded bg-purple-500/10">
                    🎙 voice
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
