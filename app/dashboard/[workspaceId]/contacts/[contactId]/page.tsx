'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface TimelineEvent {
  id: string
  at: string
  type: string
  agent: { id: string; name: string } | null
  label: string
  content?: string
  detail?: string
  meta?: Record<string, any>
}

interface Summary {
  totalEvents: number
  inboundMessages: number
  outboundMessages: number
  toolCalls: number
  followUpsSent: number
  agentsInvolved: { id: string; name: string }[]
  firstContact: string | null
  lastActivity: string | null
  memories: { agent: { id: string; name: string } | null; summary: string; updatedAt: string }[]
}

const EVENT_STYLE: Record<string, { color: string; label: string }> = {
  inbound:              { color: '#60a5fa', label: 'IN' },
  outbound:             { color: '#22c55e', label: 'OUT' },
  tool:                 { color: '#a855f7', label: 'TOOL' },
  error:                { color: '#ef4444', label: 'ERR' },
  follow_up_scheduled:  { color: '#f59e0b', label: 'SCHED' },
  follow_up_sent:       { color: '#fbbf24', label: 'SENT' },
  follow_up_cancelled:  { color: '#71717a', label: 'CXL' },
  paused:               { color: '#f87171', label: 'PAUSE' },
  resumed:              { color: '#4ade80', label: 'RESUME' },
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ContactTimelinePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const contactId = params.contactId as string
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/contacts/${contactId}/timeline`)
      .then(r => r.json())
      .then(data => {
        setEvents(data.events || [])
        setSummary(data.summary)
      })
      .finally(() => setLoading(false))
  }, [workspaceId, contactId])

  if (loading) {
    return <div className="flex-1 p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <Link
          href={`/dashboard/${workspaceId}/conversations`}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-4 inline-block"
        >
          ← Back to conversations
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Contact Timeline</h1>
          <p className="text-sm text-zinc-500 mt-1 font-mono">{contactId}</p>
        </div>

        {/* Summary */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
            <Tile label="Events" value={summary.totalEvents} />
            <Tile label="Inbound" value={summary.inboundMessages} />
            <Tile label="Outbound" value={summary.outboundMessages} />
            <Tile label="Tool calls" value={summary.toolCalls} />
            <Tile label="Follow-ups sent" value={summary.followUpsSent} />
          </div>
        )}

        {/* Agents involved */}
        {summary?.agentsInvolved && summary.agentsInvolved.length > 0 && (
          <div className="mb-6">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Agents involved</p>
            <div className="flex flex-wrap gap-2">
              {summary.agentsInvolved.map(a => (
                <Link
                  key={a.id}
                  href={`/dashboard/${workspaceId}/agents/${a.id}`}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-zinc-700 hover:text-white transition-colors"
                >
                  {a.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Agent memories (contextual notes) */}
        {summary?.memories && summary.memories.length > 0 && (
          <div className="mb-8">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Agent memories</p>
            <div className="space-y-2">
              {summary.memories.map((m, i) => (
                <div key={i} className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800">
                  {m.agent && (
                    <p className="text-[11px] font-semibold text-zinc-300 mb-1">{m.agent.name}</p>
                  )}
                  <p className="text-xs text-zinc-400 italic">{m.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        {events.length === 0 ? (
          <div className="text-center py-16 text-sm text-zinc-500">No activity yet for this contact.</div>
        ) : (
          <div className="relative">
            <div className="absolute left-[37px] top-4 bottom-4 w-px bg-zinc-800" />
            <div className="space-y-3">
              {events.map(event => {
                const style = EVENT_STYLE[event.type] || { color: '#71717a', label: 'EVT' }
                return (
                  <div key={event.id} className="relative flex items-start gap-3">
                    {/* Time */}
                    <div className="flex-shrink-0 w-20 pt-2 text-[10px] text-zinc-600 text-right">
                      {formatTime(event.at)}
                    </div>
                    {/* Type badge */}
                    <div className="relative z-10 flex-shrink-0">
                      <div
                        className="w-[54px] py-1 text-center text-[9px] font-bold rounded"
                        style={{ background: `${style.color}1a`, color: style.color }}
                      >
                        {style.label}
                      </div>
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-white">{event.label}</span>
                        {event.agent && (
                          <Link
                            href={`/dashboard/${workspaceId}/agents/${event.agent.id}`}
                            className="text-[11px] text-zinc-400 hover:text-white"
                          >
                            · {event.agent.name}
                          </Link>
                        )}
                        {event.meta?.channel && (
                          <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800">
                            {event.meta.channel}
                          </span>
                        )}
                      </div>
                      {event.content && (
                        <p className="text-xs text-zinc-400 whitespace-pre-wrap">{event.content}</p>
                      )}
                      {event.detail && !event.content && (
                        <p className="text-xs text-zinc-500">{event.detail}</p>
                      )}
                      {event.meta?.scheduledFor && (
                        <p className="text-[10px] text-amber-400 mt-1">
                          Scheduled for {formatTime(event.meta.scheduledFor)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  )
}
