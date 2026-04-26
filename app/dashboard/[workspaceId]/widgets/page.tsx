'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Widget {
  id: string
  name: string
  publicKey: string
  type?: 'chat' | 'click_to_call'
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const [notMigrated, setNotMigrated] = useState(false)

  const fetchWidgets = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/widgets`)
    const data = await res.json()
    setWidgets(data.widgets || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchWidgets() }, [fetchWidgets])

  async function createWidget(type: 'chat' | 'click_to_call') {
    setCreating(true)
    setPickerOpen(false)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widgets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: type === 'click_to_call' ? 'Click to call' : 'New chat widget',
          type,
        }),
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
            <h1 className="text-2xl font-bold text-white">Widgets</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Embeddable chat widgets and click-to-call buttons. Drop them anywhere — landing pages, blog posts, email signatures.
            </p>
          </div>
          <div className="relative">
            <button
              onClick={() => setPickerOpen(o => !o)}
              disabled={creating}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
              style={{ background: '#fa4d2e' }}
            >
              {creating ? 'Creating…' : '+ New widget'}
            </button>
            {pickerOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl border border-zinc-800 bg-zinc-950 shadow-xl z-10 overflow-hidden">
                <button
                  onClick={() => createWidget('chat')}
                  className="w-full text-left px-4 py-3 hover:bg-zinc-900 transition-colors border-b border-zinc-800"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl">💬</span>
                    <div>
                      <p className="text-sm font-semibold text-white">Chat widget</p>
                      <p className="text-[11px] text-zinc-500">Floating chat with optional voice</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => createWidget('click_to_call')}
                  className="w-full text-left px-4 py-3 hover:bg-zinc-900 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span className="text-xl">📞</span>
                    <div>
                      <p className="text-sm font-semibold text-white">Click-to-call button</p>
                      <p className="text-[11px] text-zinc-500">A styled button that opens a voice call</p>
                    </div>
                  </div>
                </button>
              </div>
            )}
          </div>
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
              Spin up a chat widget or a click-to-call button. Both get a free hosted page you can share as a link.
            </p>
            <button onClick={() => setPickerOpen(true)} disabled={creating}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white" style={{ background: '#fa4d2e' }}>
              {creating ? 'Creating…' : 'Create first widget'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {widgets.map(w => {
              const isCall = w.type === 'click_to_call'
              return (
                <Link
                  key={w.id}
                  href={`/dashboard/${workspaceId}/widgets/${w.id}`}
                  className="relative p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 transition-colors"
                >
                  <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-xl" style={{ background: w.isActive ? w.primaryColor : '#3f3f46' }} />
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white"
                      style={{ background: w.primaryColor }}>
                      {isCall ? (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-400 px-1.5 py-0.5 rounded bg-zinc-800 uppercase tracking-wide">
                        {isCall ? 'call' : 'chat'}
                      </span>
                      {!w.isActive && (
                        <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800">paused</span>
                      )}
                    </div>
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
                      <p className="text-[10px] text-zinc-500">{isCall ? 'Calls' : 'Conversations'}</p>
                    </div>
                  </div>
                  {w.voiceEnabled && !isCall && (
                    <span className="absolute bottom-3 right-3 text-[10px] font-medium text-purple-400 px-1.5 py-0.5 rounded bg-purple-500/10">
                      🎙 voice
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
