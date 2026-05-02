'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface AgentDigest {
  id: string
  name: string
  messages: number
  errors: number
  appointments: number
  toolCalls: number
  tokens: number
  followUpsSent: number
  uniqueContactsReached: number
  fallbackCount: number
  estCost: number
}

interface Totals {
  messages: number
  appointments: number
  followUpsSent: number
  newConversations: number
  tokens: number
  estCost: number
  deltaVsLastWeek: number | null
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function DigestPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [agents, setAgents] = useState<AgentDigest[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [weekStart, setWeekStart] = useState<string>('')
  const [weekEnd, setWeekEnd] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/digest`)
      .then(r => r.json())
      .then(data => {
        setAgents(data.agents || [])
        setTotals(data.totals)
        setWeekStart(data.weekStart)
        setWeekEnd(data.weekEnd)
      })
      .finally(() => setLoading(false))
  }, [workspaceId])

  if (loading) {
    return <div className="flex-1 p-8"><div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} /></div>
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-2 text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            <span>📊 Weekly digest</span>
            <span>·</span>
            <span>{weekStart && fmtDate(weekStart)} — {weekEnd && fmtDate(weekEnd)}</span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Your agents this week</h1>
        </div>

        {/* Headline totals */}
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
            <TotalCard label="Messages" value={totals.messages} delta={totals.deltaVsLastWeek} />
            <TotalCard label="Appointments" value={totals.appointments} />
            <TotalCard label="Follow-ups sent" value={totals.followUpsSent} />
            <TotalCard label="New conversations" value={totals.newConversations} />
            <TotalCard label="Est. API cost" value={`$${totals.estCost.toFixed(2)}`} sub={`${(totals.tokens / 1000).toFixed(0)}k tokens`} />
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--text-muted)' }}>Agent performance</h2>

          {agents.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: 'var(--text-muted)' }}>No agent activity this week</div>
          ) : (
            <div className="space-y-2">
              {agents.map((a, idx) => {
                const errorRate = a.messages > 0 ? Math.round((a.errors / a.messages) * 100) : 0
                const fallbackRate = a.messages > 0 ? Math.round((a.fallbackCount / a.messages) * 100) : 0
                return (
                  <Link
                    key={a.id}
                    href={`/dashboard/${workspaceId}/agents/${a.id}`}
                    className="block p-4 rounded-xl transition-colors"
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center gap-4 mb-3">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }}>
                        #{idx + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{a.name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {a.uniqueContactsReached} contacts · {a.messages} messages · {a.toolCalls} actions
                        </p>
                      </div>
                      {(errorRate > 5 || fallbackRate > 10) && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
                        >
                          Needs attention
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
                      <MiniStat label="Messages" value={a.messages} />
                      <MiniStat label="Appointments" value={a.appointments} highlight />
                      <MiniStat label="Follow-ups" value={a.followUpsSent} />
                      <MiniStat label="Tool calls" value={a.toolCalls} />
                      <MiniStat label="Errors" value={a.errors} warning={a.errors > 0} />
                      <MiniStat label="Est. cost" value={`$${a.estCost.toFixed(2)}`} />
                    </div>

                    {(a.fallbackCount > 0) && (
                      <p className="text-[11px] mt-3 pt-3" style={{ color: 'var(--accent-amber)', borderTop: '1px solid var(--border)' }}>
                        Said &ldquo;I don&apos;t know&rdquo; {a.fallbackCount} times · <Link href={`/dashboard/${workspaceId}/insights`} className="hover:underline font-medium">Review knowledge gaps →</Link>
                      </p>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Email digest controls */}
        <DigestEmailControls workspaceId={workspaceId} />
      </div>
    </div>
  )
}

function DigestEmailControls({ workspaceId }: { workspaceId: string }) {
  const [optIn, setOptIn] = useState<boolean | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [lastSent, setLastSent] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/digest/preferences`)
      .then(r => r.json())
      .then(d => {
        if (d.error) return
        setOptIn(!!d.digestOptIn)
        setEmail(d.email)
        setLastSent(d.lastDigestSentAt)
      })
      .catch(() => {})
  }, [workspaceId])

  async function toggle() {
    if (optIn === null) return
    const next = !optIn
    setOptIn(next)
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/digest/preferences`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digestOptIn: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setOptIn(!next)
        setStatus({ kind: 'err', msg: data.error || 'Could not save' })
      }
    } finally { setSaving(false) }
  }

  async function sendTest() {
    setSending(true)
    setStatus(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/digest/test-send`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setStatus({ kind: 'err', msg: data.error || 'Send failed' })
      } else {
        setStatus({ kind: 'ok', msg: `Sent to ${data.sentTo}` })
      }
    } finally { setSending(false) }
  }

  if (optIn === null) {
    return <div className="mt-12 h-16 rounded-xl animate-pulse" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
  }

  return (
    <div className="mt-12 p-5 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>📬 Email me this digest every Monday</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {email
              ? <>We&apos;ll send to <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{email}</span> at 13:00 UTC every Monday.</>
              : <>Add an email to your account to receive digests.</>}
            {lastSent && <> · Last sent {new Date(lastSent).toLocaleDateString()}.</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={sendTest}
            disabled={sending || !email}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
          >
            {sending ? 'Sending…' : 'Send me a test now'}
          </button>
          <button
            onClick={toggle}
            disabled={saving || !email}
            title={!email ? 'Set an email on your account first' : optIn ? 'Turn off weekly digest emails' : 'Turn on weekly digest emails'}
            className="relative inline-flex h-5 w-9 items-center rounded-full disabled:opacity-30"
            style={{ background: optIn ? 'var(--accent-emerald)' : 'var(--surface-tertiary)' }}
          >
            <span className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
              style={{ transform: optIn ? 'translateX(20px)' : 'translateX(4px)' }} />
          </button>
        </div>
      </div>
      {status && (
        <p className="text-xs mt-3" style={{ color: status.kind === 'ok' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
          {status.msg}
        </p>
      )}
    </div>
  )
}

function TotalCard({ label, value, sub, delta }: { label: string; value: string | number; sub?: string; delta?: number | null }) {
  return (
    <div className="p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
        {delta !== null && delta !== undefined && (
          <span className="text-[11px] font-medium" style={{ color: delta >= 0 ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
            {delta >= 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
      {sub && <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

function MiniStat({ label, value, highlight, warning }: { label: string; value: string | number; highlight?: boolean; warning?: boolean }) {
  return (
    <div>
      <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-sm font-semibold" style={{ color: highlight ? 'var(--accent-emerald)' : warning ? 'var(--accent-red)' : 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
}
