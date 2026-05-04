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
  // Populated when the contactId resolves to a native contact. Drives the
  // header so native contacts show name/email/phone instead of a bare cuid.
  const [nativeContact, setNativeContact] = useState<{
    firstName: string | null
    lastName: string | null
    email: string | null
    phone: string | null
    tags: string[]
    isSuppressed: boolean
  } | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/contacts/${contactId}/timeline`)
      .then(r => r.json())
      .then(data => {
        setEvents(data.events || [])
        setSummary(data.summary)
      })
      .finally(() => setLoading(false))

    // Best-effort native-contact lookup. 404 means this contactId is a
    // GHL/HubSpot/external id — header silently falls back to the cuid.
    fetch(`/api/workspaces/${workspaceId}/native/contacts/${contactId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.contact) {
          const c = data.contact
          setNativeContact({
            firstName: c.firstName ?? null,
            lastName: c.lastName ?? null,
            email: c.email ?? null,
            phone: c.phone ?? null,
            tags: c.tags ?? [],
            isSuppressed: !!c.isSuppressed,
          })
        }
      })
      .catch(() => {})
  }, [workspaceId, contactId])

  if (loading) {
    return <div className="flex-1 p-8"><div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} /></div>
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <Link
          href={`/dashboard/${workspaceId}/conversations`}
          className="text-xs hover:opacity-80 transition-colors mb-4 inline-block"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ← Back to conversations
        </Link>

        <div className="mb-8 flex items-start justify-between">
          <div className="min-w-0">
            {nativeContact ? (
              <>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                  {[nativeContact.firstName, nativeContact.lastName].filter(Boolean).join(' ') || '(no name)'}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                  {nativeContact.email && (
                    <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{nativeContact.email}</span>
                  )}
                  {nativeContact.phone && (
                    <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>{nativeContact.phone}</span>
                  )}
                  {nativeContact.isSuppressed && (
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
                    >
                      opted out
                    </span>
                  )}
                </div>
                {nativeContact.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {nativeContact.tags.map(t => (
                      <span
                        key={t}
                        className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Contact Timeline</h1>
                <p className="text-sm mt-1 font-mono" style={{ color: 'var(--text-tertiary)' }}>{contactId}</p>
              </>
            )}
          </div>
          {summary?.agentsInvolved && summary.agentsInvolved[0] && (
            <TakeoverControl
              workspaceId={workspaceId}
              contactId={contactId}
              agentId={summary.agentsInvolved[0].id}
            />
          )}
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
            <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Agents involved</p>
            <div className="flex flex-wrap gap-2">
              {summary.agentsInvolved.map(a => (
                <Link
                  key={a.id}
                  href={`/dashboard/${workspaceId}/agents/${a.id}`}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
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
            <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>Agent memories</p>
            <div className="space-y-2">
              {summary.memories.map((m, i) => (
                <div key={i} className="p-3 rounded-lg" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                  {m.agent && (
                    <p className="text-[11px] font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>{m.agent.name}</p>
                  )}
                  <p className="text-xs italic" style={{ color: 'var(--text-secondary)' }}>{m.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        {events.length === 0 ? (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--text-tertiary)' }}>No activity yet for this contact.</div>
        ) : (
          <div className="relative">
            <div className="absolute left-[37px] top-4 bottom-4 w-px" style={{ background: 'var(--border)' }} />
            <div className="space-y-3">
              {events.map(event => {
                const style = EVENT_STYLE[event.type] || { color: '#71717a', label: 'EVT' }
                return (
                  <div key={event.id} className="relative flex items-start gap-3">
                    {/* Time */}
                    <div className="flex-shrink-0 w-20 pt-2 text-[10px] text-right" style={{ color: 'var(--text-muted)' }}>
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
                    <div className="flex-1 min-w-0 p-3 rounded-lg" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{event.label}</span>
                        {event.agent && (
                          <Link
                            href={`/dashboard/${workspaceId}/agents/${event.agent.id}`}
                            className="text-[11px] hover:opacity-80"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            · {event.agent.name}
                          </Link>
                        )}
                        {event.meta?.channel && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }}>
                            {event.meta.channel}
                          </span>
                        )}
                      </div>
                      {event.content && (
                        <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{event.content}</p>
                      )}
                      {event.detail && !event.content && (
                        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{event.detail}</p>
                      )}
                      {event.meta?.scheduledFor && (
                        <p className="text-[10px] mt-1" style={{ color: 'var(--accent-amber)' }}>
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
    <div className="p-4 rounded-xl" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function TakeoverControl({ workspaceId, contactId, agentId }: {
  workspaceId: string; contactId: string; agentId: string
}) {
  const [active, setActive] = useState<any>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/takeover`)
      .then(r => r.json())
      .then(data => {
        const match = (data.takeovers || []).find((t: any) => t.contactId === contactId && !t.endedAt)
        setActive(match || null)
      })
      .catch(() => {})
  }, [workspaceId, contactId])

  async function start() {
    setBusy(true)
    const reason = prompt('Why are you taking over? (optional)') || undefined
    const res = await fetch(`/api/workspaces/${workspaceId}/takeover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, contactId, reason }),
    })
    if (res.ok) setActive((await res.json()).takeover)
    setBusy(false)
  }

  async function end() {
    if (!active) return
    setBusy(true)
    await fetch(`/api/workspaces/${workspaceId}/takeover/${active.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'end' }),
    })
    setActive(null)
    setBusy(false)
  }

  if (active) {
    return (
      <button
        onClick={end}
        disabled={busy}
        className="text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
        style={{ background: 'var(--accent-red-bg)', border: '1px solid var(--accent-red)', color: 'var(--accent-red)' }}
      >
        {busy ? '...' : 'Hand back to agent'}
      </button>
    )
  }

  return (
    <button
      onClick={start}
      disabled={busy}
      className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors"
      style={{ background: '#fa4d2e', color: '#fff' }}
    >
      {busy ? '...' : 'Take over conversation'}
    </button>
  )
}
