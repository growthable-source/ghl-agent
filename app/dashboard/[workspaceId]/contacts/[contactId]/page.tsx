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
  // Voice agents available for outbound calls from this contact's page.
  // Loaded once; only voice agents with an active phone number are
  // shown. We also need the contact's resolved locationId for the
  // outbound-call API.
  const [voiceAgents, setVoiceAgents] = useState<Array<{ id: string; name: string; phoneNumber: string | null }>>([])
  const [callLocationId, setCallLocationId] = useState<string | null>(null)

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
            locationId: c.locationId ?? null,
          } as any)
          if (c.locationId) setCallLocationId(c.locationId)
        }
      })
      .catch(() => {})

    // Voice agents on this workspace with a provisioned phone number.
    // Used by the Call-this-contact button to populate its picker —
    // hidden entirely when zero match. Errors are swallowed so the
    // page still renders.
    fetch(`/api/workspaces/${workspaceId}/agents`)
      .then(r => r.ok ? r.json() : null)
      .then((data: any) => {
        const all = Array.isArray(data?.agents) ? data.agents : []
        const voice = all
          .filter((a: any) => a.agentType === 'VOICE' && a.vapiConfig?.isActive && a.vapiConfig?.phoneNumber)
          .map((a: any) => ({ id: a.id, name: a.name, phoneNumber: a.vapiConfig?.phoneNumber ?? null }))
        setVoiceAgents(voice)
        // Use the first voice agent's location as a fallback for callers
        // when the native-contact lookup didn't resolve one. The
        // outbound-call route validates the location server-side.
        if (!callLocationId && all[0]?.locationId) setCallLocationId(all[0].locationId)
      })
      .catch(() => {})
  }, [workspaceId, contactId, callLocationId])

  if (loading) {
    return <div className="flex-1 p-8"><div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} /></div>
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <Link
          href={`/dashboard/${workspaceId}/contacts`}
          className="text-xs hover:opacity-80 transition-colors mb-4 inline-block"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ← All contacts
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
          <div className="flex items-center gap-2">
            {nativeContact?.phone && voiceAgents.length > 0 && callLocationId && (
              <CallThisContactButton
                voiceAgents={voiceAgents}
                contactPhone={nativeContact.phone}
                contactId={contactId}
                locationId={callLocationId}
                workspaceId={workspaceId}
              />
            )}
            {summary?.agentsInvolved && summary.agentsInvolved[0] && (
              <TakeoverControl
                workspaceId={workspaceId}
                contactId={contactId}
                agentId={summary.agentsInvolved[0].id}
              />
            )}
          </div>
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

// ─── Call this contact (outbound voice) ─────────────────────────────
// Renders a small button next to the take-over control. Hidden by the
// parent when zero voice agents match. Picking an agent in the dropdown
// dials the contact's phone via /api/actions/outbound-call.
function CallThisContactButton({
  voiceAgents, contactPhone, contactId, locationId, workspaceId,
}: {
  voiceAgents: Array<{ id: string; name: string; phoneNumber: string | null }>
  contactPhone: string
  contactId: string
  locationId: string
  workspaceId: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  async function dial(agentId: string) {
    setBusy(agentId)
    setFlash(null)
    setOpen(false)
    try {
      const res = await fetch('/api/actions/outbound-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, agentId, contactId, phone: contactPhone }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Dial failed (${res.status})`)
      setFlash({ kind: 'ok', msg: 'Call queued — phone should ring shortly.' })
    } catch (err: any) {
      setFlash({ kind: 'err', msg: err.message ?? 'Dial failed' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={!!busy}
        className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors inline-flex items-center gap-1.5"
        style={{ background: 'var(--surface-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
        title="Place an outbound voice call to this contact"
      >
        <span aria-hidden>📞</span>
        {busy ? 'Dialling…' : 'Call this contact'}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 mt-1 w-60 rounded-lg overflow-hidden z-20"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.25)' }}
          >
            <div className="px-3 py-2 text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              Pick a voice agent
            </div>
            {voiceAgents.map(a => (
              <button
                key={a.id}
                onClick={() => dial(a.id)}
                className="block w-full text-left px-3 py-2 hover:opacity-90 text-sm"
                style={{ color: 'var(--text-primary)' }}
              >
                <div className="font-medium">{a.name}</div>
                {a.phoneNumber && (
                  <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    From {a.phoneNumber}
                  </div>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      {flash && (
        <p
          className="absolute right-0 mt-2 text-[11px] whitespace-nowrap"
          style={{ color: flash.kind === 'ok' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}
        >
          {flash.msg}
        </p>
      )}
    </div>
  )
}
