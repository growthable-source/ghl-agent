'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────────────

interface NextActionJob {
  id: string
  scheduledAt: string
  createdAt: string
  lastSentAt: string | null
  channel: string
  contactId: string
  conversationId: string | null
  currentStep: number
  totalSteps: number
  status: 'SCHEDULED' | 'SENT' | 'CANCELLED' | 'FAILED'
  agent: { id: string; name: string; isActive: boolean } | null
  sequence: { id: string; name: string; triggerType: string }
  preview: string | null
}

interface SummaryByAgent {
  [agentId: string]: { count: number; nextAt: string | null; agentName: string }
}

// ─── Channel colors ─────────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SMS:       { label: 'SMS',       color: '#22d3ee', bg: 'rgba(34,211,238,0.12)' },
  WhatsApp:  { label: 'WhatsApp',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  Email:     { label: 'Email',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  FB:        { label: 'Facebook',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  IG:        { label: 'Instagram', color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  GMB:       { label: 'Google',    color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  Live_Chat: { label: 'Live Chat', color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
}

const TRIGGER_LABELS: Record<string, { label: string; desc: string }> = {
  always:   { label: 'Every exchange', desc: 'Sent after every message' },
  no_reply: { label: 'No reply',       desc: 'Sent if contact goes silent' },
  keyword:  { label: 'Keyword',        desc: 'Triggered by keyword match' },
  agent:    { label: 'Agent-decided',  desc: 'Scheduled by the AI agent' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatFutureTime(iso: string): { label: string; urgency: 'imminent' | 'soon' | 'later' } {
  const delta = new Date(iso).getTime() - Date.now()
  const mins = Math.round(delta / 60000)
  if (delta < 0) return { label: 'overdue', urgency: 'imminent' }
  if (mins < 60) return { label: `in ${mins}m`, urgency: 'imminent' }
  const hours = Math.round(mins / 60)
  if (hours < 24) return { label: `in ${hours}h`, urgency: 'soon' }
  const days = Math.round(hours / 24)
  if (days < 14) return { label: `in ${days}d`, urgency: 'later' }
  const weeks = Math.round(days / 7)
  return { label: `in ${weeks}w`, urgency: 'later' }
}

function formatExactTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function NextActionsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [jobs, setJobs] = useState<NextActionJob[]>([])
  const [summary, setSummary] = useState<{ total: number; byAgent: SummaryByAgent } | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [agentFilter, setAgentFilter] = useState<string>('all')
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'timeline' | 'calendar'>('timeline')

  const fetchJobs = useCallback(async () => {
    try {
      const qs = agentFilter !== 'all' ? `?agentId=${agentFilter}` : ''
      const res = await fetch(`/api/workspaces/${workspaceId}/next-actions${qs}`)
      const data = await res.json()
      setJobs(data.jobs || [])
      setSummary(data.summary || null)
    } catch (err) {
      console.error('Failed to fetch next actions:', err)
    } finally {
      setLoading(false)
    }
  }, [workspaceId, agentFilter])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  // Auto-refresh every 30s to reflect agent-triggered cancellations
  useEffect(() => {
    const interval = setInterval(fetchJobs, 30000)
    return () => clearInterval(interval)
  }, [fetchJobs])

  async function cancelJob(jobId: string) {
    setCancellingId(jobId)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/next-actions/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      })
      if (res.ok) {
        setJobs(prev => prev.filter(j => j.id !== jobId))
        setCancelConfirm(null)
      }
    } catch (err) {
      console.error('Failed to cancel job:', err)
    } finally {
      setCancellingId(null)
    }
  }

  // Group jobs by time bucket for a timeline view
  const buckets = useMemo(() => {
    const now = Date.now()
    const groups: Record<string, NextActionJob[]> = {
      overdue: [],
      'Next hour': [],
      Today: [],
      Tomorrow: [],
      'This week': [],
      Later: [],
    }
    for (const job of jobs) {
      const delta = new Date(job.scheduledAt).getTime() - now
      if (delta < 0) groups.overdue.push(job)
      else if (delta < 3600_000) groups['Next hour'].push(job)
      else if (delta < 24 * 3600_000) groups.Today.push(job)
      else if (delta < 48 * 3600_000) groups.Tomorrow.push(job)
      else if (delta < 7 * 24 * 3600_000) groups['This week'].push(job)
      else groups.Later.push(job)
    }
    return groups
  }, [jobs])

  const agentList = useMemo(() => {
    if (!summary?.byAgent) return []
    return Object.entries(summary.byAgent)
      .map(([id, info]) => ({ id, ...info }))
      .sort((a, b) => b.count - a.count)
  }, [summary])

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse mb-8" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-zinc-900/60 border border-zinc-800 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">

        {/* ─── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Next Actions</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Scheduled follow-ups from your agents — auto-cancel when contacts respond.
            </p>
          </div>
          {/* View toggle */}
          <div className="flex gap-1 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
            <button
              onClick={() => setViewMode('timeline')}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                viewMode === 'timeline' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              style={viewMode === 'timeline' ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
            >
              Timeline
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                viewMode === 'calendar' ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
              style={viewMode === 'calendar' ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
            >
              Calendar
            </button>
          </div>
        </div>

        {/* ─── Summary tiles ───────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-8">
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <p className="text-xs text-zinc-500 mb-1">Total Scheduled</p>
            <p className="text-2xl font-bold text-white">{summary?.total ?? 0}</p>
          </div>
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <p className="text-xs text-zinc-500 mb-1">Next Hour</p>
            <p className="text-2xl font-bold text-white">{buckets['Next hour'].length}</p>
          </div>
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <p className="text-xs text-zinc-500 mb-1">Today</p>
            <p className="text-2xl font-bold text-white">{buckets.Today.length + buckets['Next hour'].length}</p>
          </div>
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <p className="text-xs text-zinc-500 mb-1">This Week</p>
            <p className="text-2xl font-bold text-white">
              {buckets['Next hour'].length + buckets.Today.length + buckets.Tomorrow.length + buckets['This week'].length}
            </p>
          </div>
        </div>

        {/* ─── Agent filter chips ─────────────────────────────────────── */}
        {agentList.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              onClick={() => setAgentFilter('all')}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                agentFilter === 'all'
                  ? 'text-white'
                  : 'text-zinc-400 bg-zinc-900 hover:bg-zinc-800 hover:text-white'
              }`}
              style={agentFilter === 'all' ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
            >
              All agents ({summary?.total ?? 0})
            </button>
            {agentList.map(a => (
              <button
                key={a.id}
                onClick={() => setAgentFilter(a.id)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  agentFilter === a.id
                    ? 'text-white'
                    : 'text-zinc-400 bg-zinc-900 hover:bg-zinc-800 hover:text-white'
                }`}
                style={agentFilter === a.id ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
              >
                {a.agentName} ({a.count})
              </button>
            ))}
          </div>
        )}

        {/* ─── Empty state ─────────────────────────────────────────────── */}
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-16 h-16 mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">No scheduled actions</h3>
            <p className="text-sm text-zinc-400 text-center max-w-md mb-4">
              Your agents have no follow-ups queued. When they schedule one — either via sequences or by
              deciding themselves — it will appear here so you can review or cancel it.
            </p>
            <Link
              href={`/dashboard/${workspaceId}/agents`}
              className="text-sm font-medium hover:underline"
              style={{ color: '#fa4d2e' }}
            >
              Configure agent follow-ups →
            </Link>
          </div>
        ) : viewMode === 'calendar' ? (
          /* ─── Calendar view (next 14 days) ───────────────────────────── */
          <CalendarView jobs={jobs} workspaceId={workspaceId} onCancel={cancelJob} />
        ) : (
          /* ─── Timeline view ──────────────────────────────────────────── */
          <div className="space-y-6">
            {Object.entries(buckets).map(([bucketName, bucketJobs]) => {
              if (bucketJobs.length === 0) return null
              const isOverdue = bucketName === 'overdue'
              return (
                <div key={bucketName}>
                  <div className="flex items-center gap-2 mb-3">
                    <h2 className={`text-xs font-semibold uppercase tracking-wider ${
                      isOverdue ? 'text-red-400' : 'text-zinc-500'
                    }`}>
                      {bucketName} ({bucketJobs.length})
                    </h2>
                    <div className="flex-1 h-px bg-zinc-800" />
                  </div>

                  <div className="space-y-2">
                    {bucketJobs.map(job => {
                      const channel = CHANNEL_CONFIG[job.channel] || CHANNEL_CONFIG.SMS
                      const trigger = TRIGGER_LABELS[job.sequence.triggerType] || TRIGGER_LABELS.always
                      const time = formatFutureTime(job.scheduledAt)
                      const exact = formatExactTime(job.scheduledAt)

                      return (
                        <div
                          key={job.id}
                          className="group flex items-start gap-4 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 transition-colors"
                        >
                          {/* Timeline dot */}
                          <div className="flex-shrink-0 mt-1">
                            <div
                              className="w-2.5 h-2.5 rounded-full"
                              style={{
                                background: time.urgency === 'imminent' ? '#fa4d2e'
                                  : time.urgency === 'soon' ? '#fbbf24'
                                  : '#52525b',
                                boxShadow: time.urgency === 'imminent' ? '0 0 0 4px rgba(250,77,46,0.15)' : undefined,
                              }}
                            />
                          </div>

                          {/* Main content */}
                          <div className="flex-1 min-w-0">
                            {/* Top row: agent name + time */}
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              {job.agent ? (
                                <Link
                                  href={`/dashboard/${workspaceId}/agents/${job.agent.id}`}
                                  className="text-sm font-semibold text-white hover:underline"
                                >
                                  {job.agent.name}
                                </Link>
                              ) : (
                                <span className="text-sm font-semibold text-zinc-500">(deleted agent)</span>
                              )}

                              <span className="text-zinc-600 text-xs">→</span>

                              <span
                                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                                style={{ background: channel.bg, color: channel.color }}
                              >
                                {channel.label}
                              </span>

                              <span
                                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                                style={{ background: 'rgba(250,77,46,0.08)', color: '#fa4d2e' }}
                                title={trigger.desc}
                              >
                                {trigger.label}
                              </span>

                              {job.totalSteps > 1 && (
                                <span className="text-[11px] text-zinc-500">
                                  Step {job.currentStep} of {job.totalSteps}
                                </span>
                              )}

                              <span className="ml-auto text-xs text-zinc-500" title={exact}>
                                <span className={
                                  time.urgency === 'imminent' ? 'text-red-400 font-medium'
                                  : time.urgency === 'soon' ? 'text-amber-400 font-medium'
                                  : 'text-zinc-400'
                                }>
                                  {time.label}
                                </span>
                                <span className="text-zinc-600"> · {exact}</span>
                              </span>
                            </div>

                            {/* Sequence + contact */}
                            <p className="text-xs text-zinc-500 mb-1.5">
                              <span className="text-zinc-400">{job.sequence.name}</span>
                              <span className="mx-1.5 text-zinc-700">·</span>
                              Contact <span className="text-zinc-400 font-mono">{job.contactId.slice(-8)}</span>
                            </p>

                            {/* Message preview */}
                            {job.preview && (
                              <p className="text-xs text-zinc-500 italic line-clamp-1">
                                &ldquo;{job.preview}{job.preview.length >= 120 ? '…' : ''}&rdquo;
                              </p>
                            )}
                          </div>

                          {/* Cancel action */}
                          <div className="flex-shrink-0">
                            {cancelConfirm === job.id ? (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => cancelJob(job.id)}
                                  disabled={cancellingId === job.id}
                                  className="text-xs font-medium py-1.5 px-3 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                                >
                                  {cancellingId === job.id ? '...' : 'Confirm'}
                                </button>
                                <button
                                  onClick={() => setCancelConfirm(null)}
                                  className="text-xs font-medium py-1.5 px-2 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                  Keep
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setCancelConfirm(job.id)}
                                className="text-xs font-medium py-1.5 px-3 rounded-lg border border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ─── Footer note ─────────────────────────────────────────────── */}
        {jobs.length > 0 && (
          <p className="text-xs text-zinc-600 text-center mt-8">
            Auto-refreshing every 30 seconds · Follow-ups cancel automatically when contacts reply
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Calendar View ─────────────────────────────────────────────────────────

function CalendarView({
  jobs,
  workspaceId,
  onCancel,
}: {
  jobs: NextActionJob[]
  workspaceId: string
  onCancel: (id: string) => void
}) {
  // Build a 14-day grid starting from today
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days: { date: Date; jobs: NextActionJob[] }[] = []
  for (let i = 0; i < 14; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dayStart = d.getTime()
    const dayEnd = dayStart + 86400000
    const dayJobs = jobs.filter(j => {
      const t = new Date(j.scheduledAt).getTime()
      return t >= dayStart && t < dayEnd
    })
    days.push({ date: d, jobs: dayJobs })
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div>
      {/* Day-of-week header for first row */}
      <div className="grid grid-cols-7 gap-2 mb-2">
        {Array.from({ length: 7 }).map((_, i) => {
          const d = new Date(today)
          d.setDate(today.getDate() + i)
          return (
            <div key={i} className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600 text-center">
              {dayNames[d.getDay()]}
            </div>
          )
        })}
      </div>

      {/* 14 day grid as two weeks */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((day, i) => {
          const isToday = i === 0
          const dayNum = day.date.getDate()
          const monthName = day.date.toLocaleString('en-US', { month: 'short' })
          return (
            <div
              key={i}
              className={`min-h-[120px] p-2 rounded-lg border transition-colors ${
                isToday
                  ? 'border-orange-500/40 bg-orange-500/5'
                  : day.jobs.length > 0
                  ? 'border-zinc-700 bg-zinc-900/60'
                  : 'border-zinc-800 bg-zinc-900/30'
              }`}
            >
              <div className="flex items-baseline justify-between mb-2">
                <span className={`text-xs font-semibold ${isToday ? 'text-orange-400' : 'text-zinc-400'}`}>
                  {dayNum}
                </span>
                {day.date.getDate() === 1 && (
                  <span className="text-[10px] text-zinc-500">{monthName}</span>
                )}
                {day.jobs.length > 0 && (
                  <span className="text-[10px] font-bold text-zinc-500">{day.jobs.length}</span>
                )}
              </div>
              <div className="space-y-1">
                {day.jobs.slice(0, 4).map(job => {
                  const time = new Date(job.scheduledAt)
                  const hhmm = time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  return (
                    <div
                      key={job.id}
                      className="group relative text-[10px] px-1.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors truncate"
                      title={`${hhmm} · ${job.agent?.name} · ${job.sequence.name}`}
                    >
                      <span className="text-zinc-400">{hhmm}</span>{' '}
                      <span className="text-zinc-300 truncate">{job.agent?.name || '—'}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); onCancel(job.id) }}
                        className="absolute top-0.5 right-0.5 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Cancel"
                      >
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
                {day.jobs.length > 4 && (
                  <Link
                    href={`/dashboard/${workspaceId}/next-actions`}
                    className="block text-[10px] text-orange-400 font-medium text-center py-0.5"
                  >
                    +{day.jobs.length - 4} more
                  </Link>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
