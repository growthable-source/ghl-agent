'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import * as Lucide from 'lucide-react'
import { Avatar, KpiTile, Pill } from '@/components/ui/primitives'

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

// Icon + tone per timeline event (replaces the old IN/OUT text badges).
const EVENT_VISUAL: Record<string, { icon: string; cls: string }> = {
  inbound:             { icon: 'MessageSquare', cls: 'bg-rose-50 border-rose-200 text-rose-600' },
  outbound:            { icon: 'MessageSquare', cls: 'bg-emerald-50 border-emerald-200 text-emerald-600' },
  tool:                { icon: 'Wrench',        cls: 'bg-violet-50 border-violet-200 text-violet-600' },
  error:               { icon: 'TriangleAlert', cls: 'bg-red-50 border-red-200 text-red-600' },
  follow_up_scheduled: { icon: 'Clock',         cls: 'bg-amber-50 border-amber-200 text-amber-600' },
  follow_up_sent:      { icon: 'Send',          cls: 'bg-sky-50 border-sky-200 text-sky-600' },
  follow_up_cancelled: { icon: 'CircleX',       cls: 'bg-stone-50 border-stone-200 text-stone-500' },
  paused:              { icon: 'Pause',         cls: 'bg-amber-50 border-amber-200 text-amber-600' },
  resumed:             { icon: 'Play',          cls: 'bg-emerald-50 border-emerald-200 text-emerald-600' },
  default:             { icon: 'User',          cls: 'bg-stone-50 border-stone-200 text-stone-500' },
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
  const [activityFilter, setActivityFilter] = useState<'all' | 'conversations' | 'system'>('all')
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
    return <div className="flex-1 p-6"><div className="h-8 w-48 rounded animate-pulse bg-surface-tertiary" /></div>
  }

  const displayName = nativeContact
    ? ([nativeContact.firstName, nativeContact.lastName].filter(Boolean).join(' ') || '(no name)')
    : 'Contact'
  const sorted = [...events].sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
  const shown = sorted.filter(e => activityFilter === 'all' ? true
    : activityFilter === 'conversations' ? (e.type === 'inbound' || e.type === 'outbound')
    : !(e.type === 'inbound' || e.type === 'outbound'))

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Header: avatar · name + status · contact lines  |  actions */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 shrink-0 bg-surface border-b border-border-theme">
        <div className="flex items-center gap-4 min-w-0">
          <Avatar name={nativeContact ? displayName : contactId.slice(-4)} size={52} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-text-primary truncate">
                {nativeContact ? displayName : 'Contact timeline'}
              </h1>
              {nativeContact?.isSuppressed && <Pill tone="danger">Opted out</Pill>}
              {/* TODO(redesign-followup): stage pill and CRM-source pill (Qualified · GoHighLevel) — stage isn't stored on the contact. */}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[13px] text-text-secondary">
              {nativeContact ? (
                <>
                  {nativeContact.email && <span>{nativeContact.email}</span>}
                  {nativeContact.phone && <span className="font-mono text-[12.5px]">{nativeContact.phone}</span>}
                </>
              ) : (
                <span className="font-mono text-[12.5px] text-text-tertiary">{contactId}</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
          {/* TODO(redesign-followup): Message / Open in CRM header actions. */}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          {summary && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <KpiTile label="Events" value={summary.totalEvents} />
              <KpiTile label="Inbound" value={summary.inboundMessages} />
              <KpiTile label="Outbound" value={summary.outboundMessages} />
              <KpiTile label="Tool calls" value={summary.toolCalls} />
              <KpiTile label="Follow-ups sent" value={summary.followUpsSent} />
            </div>
          )}

          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-[15px] font-semibold text-text-primary">Activity</h2>
            <div className="inline-flex items-center rounded-md bg-surface-secondary p-0.5">
              {([['all', 'All'], ['conversations', 'Conversations'], ['system', 'System']] as const).map(([k, label]) => (
                <button key={k} type="button" aria-pressed={activityFilter === k} onClick={() => setActivityFilter(k)}
                  className={`h-7 px-2.5 rounded text-[12px] font-medium cursor-pointer ${activityFilter === k ? 'bg-surface text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary'}`}>
                  {label}
                </button>
              ))}
            </div>
            {/* TODO(redesign-followup): Calls and Appointments filters — the contact timeline API doesn't emit call or appointment events. */}
          </div>

          {shown.length === 0 ? (
            <div className="xv-card text-center py-14 text-[13px] text-text-tertiary">No activity yet for this contact.</div>
          ) : (
            <ol className="relative space-y-3">
              <span aria-hidden className="absolute left-[17px] top-4 bottom-4 w-px bg-border-theme" />
              {shown.map(event => {
                const st = EVENT_VISUAL[event.type] ?? EVENT_VISUAL.default
                const Icon = (Lucide as unknown as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>)[st.icon]
                return (
                  <li key={event.id} className="relative flex items-start gap-3">
                    <span className={`relative z-10 h-9 w-9 shrink-0 rounded-full border flex items-center justify-center ${st.cls}`}>
                      {Icon && <Icon className="w-4 h-4" strokeWidth={1.8} />}
                    </span>
                    <div className="xv-card flex-1 min-w-0 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-[13.5px] font-medium text-text-primary">
                          {event.label}
                          {event.agent && (
                            <Link href={`/dashboard/${workspaceId}/agents/${event.agent.id}`} className="font-normal text-text-secondary hover:underline"> · {event.agent.name}</Link>
                          )}
                          {event.meta?.channel && <span className="ml-2 align-middle"><Pill>{String(event.meta.channel)}</Pill></span>}
                        </p>
                        <span className="text-[12px] text-text-tertiary whitespace-nowrap">{formatTime(event.at)}</span>
                      </div>
                      {event.content && <p className="mt-1 text-[13px] whitespace-pre-wrap text-text-secondary">{event.content}</p>}
                      {event.detail && !event.content && <p className="mt-1 text-[13px] text-text-tertiary">{event.detail}</p>}
                      {event.meta?.scheduledFor && (
                        <p className="mt-1 text-[12px] text-amber-600">Scheduled for {formatTime(event.meta.scheduledFor)}</p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        {/* Right sidebar: details, agents, memories, tags */}
        <aside className="hidden lg:block w-[300px] shrink-0 border-l border-border-theme bg-surface overflow-y-auto">
          {summary?.memories && summary.memories.length > 0 && (
            <section className="p-5 border-b border-border-theme">
              <h3 className="text-[10.5px] uppercase tracking-wider font-semibold text-text-muted mb-2">Agent memory</h3>
              <div className="space-y-2.5">
                {summary.memories.map((m, i) => (
                  <div key={i}>
                    {m.agent && <p className="text-[11.5px] font-semibold text-text-secondary">{m.agent.name}</p>}
                    <p className="text-[13px] leading-relaxed text-text-primary">{m.summary}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
          <section className="p-5 border-b border-border-theme">
            <h3 className="text-[10.5px] uppercase tracking-wider font-semibold text-text-muted mb-2">Details</h3>
            <dl className="text-[13px]">
              {[
                ['Email', nativeContact?.email],
                ['Phone', nativeContact?.phone],
                ['Status', nativeContact ? (nativeContact.isSuppressed ? 'Opted out' : 'Active') : null],
                ['First contact', summary?.firstContact ? formatTime(summary.firstContact) : null],
                ['Last activity', summary?.lastActivity ? formatTime(summary.lastActivity) : null],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k as string} className="flex items-start justify-between gap-4 py-2 border-b border-border-theme last:border-0">
                  <dt className="text-text-secondary">{k}</dt>
                  <dd className="text-right font-medium text-text-primary break-all">{v}</dd>
                </div>
              ))}
            </dl>
            {/* TODO(redesign-followup): Stage, Owner, Source, Lifetime value, Preferred channel, Timezone, Consent and Custom fields — not exposed by the contact/timeline APIs. */}
          </section>
          {summary?.agentsInvolved && summary.agentsInvolved.length > 0 && (
            <section className="p-5 border-b border-border-theme">
              <h3 className="text-[10.5px] uppercase tracking-wider font-semibold text-text-muted mb-2">Agents involved</h3>
              <div className="flex flex-wrap gap-1.5">
                {summary.agentsInvolved.map(a => (
                  <Link key={a.id} href={`/dashboard/${workspaceId}/agents/${a.id}`}><Pill tone="neutral">{a.name}</Pill></Link>
                ))}
              </div>
            </section>
          )}
          {nativeContact && nativeContact.tags.length > 0 && (
            <section className="p-5">
              <h3 className="text-[10.5px] uppercase tracking-wider font-semibold text-text-muted mb-2">Lists &amp; tags</h3>
              <div className="flex flex-wrap gap-1.5">{nativeContact.tags.map(t => <Pill key={t}>{t}</Pill>)}</div>
            </section>
          )}
        </aside>
      </div>
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
