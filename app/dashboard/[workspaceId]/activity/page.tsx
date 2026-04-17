'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Event {
  id: string
  type: string
  at: string
  agent: { id: string; name: string } | null
  contactId: string
  icon: string
  label: string
  detail?: string
  channel?: string
  status?: string
  conversationId?: string | null
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function ActivityPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [events, setEvents] = useState<Event[]>([])
  const [live, setLive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const seenIds = useRef(new Set<string>())

  const fetchEvents = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/activity`)
    const data = await res.json()
    const incoming: Event[] = data.events || []
    if (seenIds.current.size === 0) {
      incoming.forEach(e => seenIds.current.add(e.id))
      setEvents(incoming)
    } else {
      // Only prepend new events
      const fresh = incoming.filter(e => !seenIds.current.has(e.id))
      fresh.forEach(e => seenIds.current.add(e.id))
      if (fresh.length > 0) {
        setEvents(prev => [...fresh, ...prev].slice(0, 300))
      }
    }
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchEvents() }, [fetchEvents])
  useEffect(() => {
    if (!live) return
    const i = setInterval(fetchEvents, 5000) // 5 second polling when live
    return () => clearInterval(i)
  }, [live, fetchEvents])

  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter)

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Live Activity</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Every action your agents take, as it happens.
            </p>
          </div>
          <button
            onClick={() => setLive(!live)}
            className={`flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
              live
                ? 'border-emerald-500/40 text-emerald-400 bg-emerald-500/10'
                : 'border-zinc-700 text-zinc-400'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            {live ? 'Live' : 'Paused'}
          </button>
        </div>

        {/* Filter chips */}
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            { k: 'all',                  l: 'All' },
            { k: 'message',              l: 'Replies' },
            { k: 'tool',                 l: 'Tool calls' },
            { k: 'follow_up_scheduled',  l: 'Scheduled' },
            { k: 'follow_up_sent',       l: 'Follow-ups sent' },
            { k: 'follow_up_cancelled',  l: 'Cancelled' },
          ].map(f => (
            <button
              key={f.k}
              onClick={() => setFilter(f.k)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                filter === f.k
                  ? 'text-white'
                  : 'text-zinc-400 bg-zinc-900 hover:bg-zinc-800 hover:text-white'
              }`}
              style={filter === f.k ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
            >
              {f.l}
            </button>
          ))}
        </div>

        {/* Feed */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-14 bg-zinc-900/40 border border-zinc-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">
            No recent activity
          </div>
        ) : (
          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute left-[11px] top-3 bottom-3 w-px bg-zinc-800" />

            <div className="space-y-1">
              {filtered.map(event => (
                <div key={event.id} className="relative flex items-start gap-3 p-2 rounded-lg hover:bg-zinc-900/40 transition-colors">
                  {/* Dot */}
                  <div className="relative z-10 flex-shrink-0 w-6 h-6 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-xs">
                    {event.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      {event.agent ? (
                        <Link
                          href={`/dashboard/${workspaceId}/agents/${event.agent.id}`}
                          className="font-semibold text-white hover:underline"
                        >
                          {event.agent.name}
                        </Link>
                      ) : (
                        <span className="font-semibold text-zinc-500">(unknown)</span>
                      )}
                      <span className="text-zinc-400">{event.label}</span>
                      {event.channel && (
                        <span className="text-[10px] font-medium text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800">
                          {event.channel}
                        </span>
                      )}
                      {event.status === 'ERROR' && (
                        <span className="text-[10px] font-medium text-red-400 px-1.5 py-0.5 rounded bg-red-500/10">
                          ERROR
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-600">{timeAgo(event.at)}</span>
                    </div>
                    {event.detail && (
                      <p className="text-xs text-zinc-500 truncate mt-0.5">
                        &ldquo;{event.detail}&rdquo;
                      </p>
                    )}
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      Contact <span className="font-mono">{event.contactId.slice(-8)}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
