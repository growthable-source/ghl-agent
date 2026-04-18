'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Row {
  id: string
  widget: { id: string; name: string }
  visitor: { id: string; name: string | null; email: string | null; cookieId: string }
  status: string
  lastMessageAt: string
  lastMessage: { role: string; content: string; createdAt: string } | null
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

export default function InboxPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)

  const fetchRows = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations`)
    const data = await res.json()
    setRows(data.conversations || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchRows() }, [fetchRows])
  useEffect(() => {
    const i = setInterval(fetchRows, 15000)
    return () => clearInterval(i)
  }, [fetchRows])

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Inbox</h1>
          <p className="text-sm text-zinc-400 mt-1">Website chat conversations across all your widgets.</p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300">Run manual_widget_migration.sql to enable the inbox.</p>
          </div>
        )}

        {rows.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">📥</div>
            <p className="text-sm font-medium text-white mb-1">No conversations yet</p>
            <p className="text-xs text-zinc-500">Install a widget on your site to start capturing chats.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
            {rows.map(r => (
              <Link
                key={r.id}
                href={`/dashboard/${workspaceId}/inbox/${r.id}`}
                className="flex items-start gap-3 p-4 hover:bg-zinc-900/60 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-semibold text-zinc-300 flex-shrink-0">
                  {(r.visitor.name || r.visitor.email || 'V').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <p className="text-sm font-semibold text-white truncate">
                      {r.visitor.name || r.visitor.email || `Visitor ${r.visitor.cookieId.slice(-6)}`}
                    </p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{r.widget.name}</span>
                    {r.status === 'handed_off' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">taken over</span>
                    )}
                    {r.status === 'ended' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">ended</span>
                    )}
                    <span className="ml-auto text-[10px] text-zinc-500">{timeAgo(r.lastMessageAt)}</span>
                  </div>
                  {r.lastMessage && (
                    <p className="text-xs text-zinc-500 truncate">
                      <span className="text-zinc-600">{r.lastMessage.role === 'visitor' ? 'Visitor' : r.lastMessage.role === 'agent' ? 'Agent' : ''}:</span>{' '}
                      {r.lastMessage.content}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {rows.length > 0 && (
          <p className="text-xs text-zinc-600 text-center mt-6">Auto-refreshes every 15 seconds</p>
        )}
      </div>
    </div>
  )
}
