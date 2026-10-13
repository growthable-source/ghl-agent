'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { parseRange } from '@/lib/command-palette'
import { useSession } from 'next-auth/react'
import { buttonClass } from '@/lib/ui-classes'
import { ChannelPill, StatusBadge, Sparkline } from '@/components/ui/primitives'
import { channelKind } from '@/lib/agents-list'
import Link from 'next/link'
import SetupChecklist from '@/components/dashboard/SetupChecklist'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell,
} from 'recharts'

// ─── Types ──────────────────────────────────────────────────────────────────

interface KPI {
  totalMessages: number
  successRate: number
  activeConversations: number
  totalConversations: number
  appointmentsBooked: number
  callCount: number
  totalCallMinutes: number
  totalTokens: number
  activeAgents: number
  estimatedMinutesSaved: number
  errorMessages: number
  skippedMessages: number
  messagesDelta?: number | null
  successRateDelta?: number | null
  callsDelta?: number | null
  tokensDelta?: number | null
}

interface TimeSeriesEntry {
  date: string
  messages: number
  success: number
  errors: number
  calls: number
  appointments: number
  tokens: number
}

interface AgentBreakdown {
  id: string
  name: string
  messages: number
  success: number
  appointments: number
  calls: number
  successRate: number
}

interface RecentCall {
  id: string
  contactPhone: string | null
  direction: string
  status: string
  durationSecs: number | null
  summary: string | null
  createdAt: string
  agentId: string | null
}

interface AnalyticsData {
  range: number
  kpi: KPI
  timeSeries: TimeSeriesEntry[]
  agentBreakdown: AgentBreakdown[]
  channelBreakdown: { channel: string; agents: number }[]
  recentCalls: RecentCall[]
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  SMS: 'SMS', WhatsApp: 'WhatsApp', Email: 'Email', FB: 'Facebook',
  IG: 'Instagram', GMB: 'Google', Live_Chat: 'Live Chat',
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function formatNum(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toLocaleString()
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function DeltaBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return null
  const positive = value >= 0
  return (
    <span
      className="text-[11px] font-medium"
      style={{ color: positive ? 'var(--accent-emerald)' : 'var(--accent-red)' }}
    >
      {positive ? '+' : ''}{value}%
    </span>
  )
}

// ─── Custom Recharts Tooltip ────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-lg px-3 py-2 shadow-xl text-xs"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        color: 'var(--text-primary)',
      }}
    >
      <p className="mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>{p.name}:</span> {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

// Client view for the workspace dashboard. Rendered by the server
// shell at page.tsx after the empty-workspace agent-count check runs.
export default function WorkspaceDashboardView() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  // Range now lives in the top bar (TopBarActions) as the `?range=` URL param.
  const range = parseRange(useSearchParams().get('range'))
  const { data: session } = useSession()
  const firstName = session?.user?.name?.split(' ')[0] ?? null
  const [agents, setAgents] = useState<any[]>([])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/analytics?range=${range}&compare=true`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/agents`).then(r => r.json()),
    ])
      .then(([analytics, agentData]) => {
        setData(analytics)
        setAgents(agentData.agents || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [workspaceId, range])

  // Format dates for chart x-axis
  const chartData = useMemo(() => {
    if (!data?.timeSeries) return []
    return data.timeSeries.map(d => ({
      ...d,
      label: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
    }))
  }, [data?.timeSeries])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div
            className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent-primary)' }}
          />
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading analytics...</p>
        </div>
      </div>
    )
  }

  const kpi = data?.kpi

  // Brand-new / empty workspace: no analytics yet, but the user still
  // needs orientation. Render the setup checklist on its own rather
  // than a blank screen (this is the page a first-time user lands on).
  if (!kpi) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Welcome to Xovera</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            Your AI agents, knowledge, and conversations — all in one place. Start here.
          </p>
        </div>
        <SetupChecklist workspaceId={workspaceId} />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* First-run checklist — hides itself once the workspace is fully
          set up, so established workspaces never see it. */}
      <SetupChecklist workspaceId={workspaceId} />

      {/* Header: greeting + workspace summary; range lives in the top bar. */}
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight text-text-primary">{greeting(firstName)}</h1>
          <p className="text-[13px] mt-1 text-text-tertiary">
            {agents.length} agent{agents.length === 1 ? '' : 's'} · {kpi.activeAgents} live · Workspace performance {rangeLabel(range)}
          </p>
        </div>
        <Link href={`/dashboard/${workspaceId}/agents/new`} className={buttonClass('primary')}>
          + New agent
        </Link>
      </div>

      {/* ─── KPI tiles ─── label + delta, big number, sparkline from the
          existing daily time series (where one exists for the metric). */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        {[
          { label: 'Messages',      value: formatNum(kpi.totalMessages),                          delta: kpi.messagesDelta,      spark: chartData.map(d => d.success + d.errors), tone: 'brand' as const },
          { label: 'Success rate',  value: `${kpi.successRate}%`,                                 delta: kpi.successRateDelta },
          { label: 'Active convos', value: formatNum(kpi.activeConversations) },
          { label: 'Appointments',  value: kpi.appointmentsBooked.toString(),                                                    spark: chartData.map(d => d.appointments), tone: 'emerald' as const },
          { label: 'Voice calls',   value: kpi.callCount.toString(),                              delta: kpi.callsDelta,         spark: chartData.map(d => d.calls), tone: 'violet' as const },
          { label: 'Time saved',    value: `${Math.round(kpi.estimatedMinutesSaved / 60)}h` },
        ].map(card => (
          <div key={card.label} className="xv-card px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[12px] text-text-tertiary">{card.label}</p>
              {card.delta !== undefined && <DeltaBadge value={card.delta} />}
            </div>
            <div className="flex items-end justify-between gap-2 mt-1.5">
              <p className="text-[24px] font-semibold leading-none tracking-tight tabular-nums text-text-primary">{card.value}</p>
              {card.spark && <Sparkline values={card.spark} tone={card.tone} width={72} height={26} />}
            </div>
          </div>
        ))}
      </div>
      {/* TODO(redesign-followup): sparklines for Success rate / Active convos / Time saved — the analytics time series has no per-day series for them. */}

      {/* ─── Charts Row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
        {/* Messages Over Time */}
        <div
          className="xv-card p-4"
        >
          <h3 className="text-[14px] font-semibold text-text-primary mb-4">Messages Over Time</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="msgGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                {/* Horizontal-only gridlines. Solid, low-opacity border
                    token — adapts to theme. No dash-dot. */}
                <CartesianGrid horizontal vertical={false} stroke="var(--border)" strokeOpacity={0.7} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="success"
                  name="Successful"
                  stroke="var(--accent-primary)"
                  fill="url(#msgGradient)"
                  strokeWidth={2.5}
                />
                <Area
                  type="monotone"
                  dataKey="errors"
                  name="Errors"
                  stroke="var(--accent-red)"
                  fill="transparent"
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Calls & Appointments */}
        <div
          className="xv-card p-4"
        >
          <h3 className="text-[14px] font-semibold text-text-primary mb-4">Calls & Appointments</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid horizontal vertical={false} stroke="var(--border)" strokeOpacity={0.7} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="calls" name="Voice Calls" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="appointments" name="Appointments" fill="var(--accent-emerald)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── Agent Performance + Recent Calls ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
        {/* Agent Breakdown */}
        <div
          className="lg:col-span-2 xv-card p-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-text-primary">Agent Performance</h3>
            <Link
              href={`/dashboard/${workspaceId}/agents`}
              className="text-[12px] font-medium text-brand-500 hover:text-brand-600"
            >
              All agents →
            </Link>
          </div>

          {agents.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm mb-3" style={{ color: 'var(--text-tertiary)' }}>No agents yet</p>
              <Link
                href={`/dashboard/${workspaceId}/agents/new`}
                className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                Create First Agent
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Header row */}
              <div
                className="grid grid-cols-[1fr_72px_56px_56px_72px_84px] gap-2 px-3 text-[11px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-muted)' }}
              >
                <span>Agent</span>
                <span className="text-right">Messages</span>
                <span className="text-right">Calls</span>
                <span className="text-right">Appts</span>
                <span className="text-right">Success</span>
                <span className="text-right">Status</span>
              </div>
              {agents.map((agent: any) => {
                const breakdown = data?.agentBreakdown?.find(a => a.id === agent.id)
                const channels = agent.channelDeployments?.map((d: any) => d.channel) || []

                return (
                  <Link
                    key={agent.id}
                    href={`/dashboard/${workspaceId}/agents/${agent.id}`}
                    className="grid grid-cols-[1fr_72px_56px_56px_72px_84px] gap-2 items-center rounded-lg px-3 py-2.5 hover:bg-zinc-900 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{agent.name}</p>
                      <div className="flex flex-wrap items-center gap-1 mt-1">
                        {channels.slice(0, 3).map((ch: string) => {
                          const k = channelKind(ch)
                          return k ? <ChannelPill key={ch} channel={k} /> : (
                            <span key={ch} className="text-[10px] text-text-muted">{CHANNEL_LABELS[ch] ?? ch}</span>
                          )
                        })}
                        {channels.length > 3 && <span className="text-[10px] text-text-muted">+{channels.length - 3}</span>}
                      </div>
                    </div>
                    <span className="text-sm text-right font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {breakdown?.messages || 0}
                    </span>
                    <span className="text-sm text-right font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {breakdown?.calls || 0}
                    </span>
                    <span className="text-sm text-right font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {breakdown?.appointments || 0}
                    </span>
                    <span className="text-sm text-right font-medium" style={{
                      color: (breakdown?.successRate || 0) >= 90 ? 'var(--accent-emerald)'
                        : (breakdown?.successRate || 0) >= 70 ? 'var(--accent-amber)' : 'var(--accent-red)'
                    }}>
                      {breakdown?.successRate ?? 0}%
                    </span>
                    <div className="flex justify-end">
                      <StatusBadge status={agent.isActive ? 'live' : 'paused'} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent Voice Calls */}
        <div
          className="xv-card p-4"
        >
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[14px] font-semibold text-text-primary">Recent Calls</h3>
            <Link
              href={`/dashboard/${workspaceId}/calls`}
              className="text-[12px] font-medium text-brand-500 hover:text-brand-600"
            >
              View all →
            </Link>
          </div>

          {(!data?.recentCalls || data.recentCalls.length === 0) ? (
            <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>No calls yet</p>
          ) : (
            <div className="space-y-2">
              {data.recentCalls.slice(0, 6).map(call => (
                <div
                  key={call.id}
                  className="rounded-lg px-3 py-2.5"
                  style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border-secondary)' }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{call.direction === 'inbound' ? '📥' : '📤'}</span>
                      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                        {call.contactPhone || 'Unknown'}
                      </span>
                    </div>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{timeAgo(call.createdAt)}</span>
                  </div>
                  {call.summary && (
                    <p className="text-[11px] line-clamp-2 mb-1" style={{ color: 'var(--text-tertiary)' }}>{call.summary}</p>
                  )}
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={`inline-flex items-center h-5 px-2 rounded-full border font-medium ${
                      call.status === 'completed' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : call.status === 'failed' ? 'bg-red-50 border-red-200 text-red-700'
                        : 'bg-stone-50 border-stone-200 text-stone-600'}`}>
                      {call.status}
                    </span>
                    {call.durationSecs != null && (
                      <span style={{ color: 'var(--text-muted)' }}>{formatDuration(call.durationSecs)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Channel Distribution + Quick Stats ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Channels — donut. Was a textual list of "X agents per
            channel" which read like a config dump. Donut shows the
            same data visually + scales with channel count. */}
        <ChannelDonut breakdown={data?.channelBreakdown ?? []} />

        <IntegrationHealthCard workspaceId={workspaceId} />

        {/* AI Usage — big-number card, unchanged. */}
        <div
          className="xv-card p-4"
        >
          <h3 className="text-[14px] font-semibold text-text-primary mb-3">AI Usage</h3>
          <div className="space-y-3">
            <div>
              <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatNum(kpi.totalTokens)}</p>
              <p className="text-[11px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-tertiary)' }}>tokens consumed</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{kpi.activeAgents}</p>
              <p className="text-[11px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-tertiary)' }}>active agents</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{kpi.totalCallMinutes} min</p>
              <p className="text-[11px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-tertiary)' }}>voice call time</p>
            </div>
          </div>
        </div>

        {/* Message Outcomes — donut. Was three text rows + a thin
            stacked bar; the donut shows the success/error/skipped
            ratio at a glance and the success-rate big number anchors
            the eye in the centre. */}
        <OutcomesDonut
          success={Math.max(0, kpi.totalMessages - kpi.errorMessages - kpi.skippedMessages)}
          errors={kpi.errorMessages}
          skipped={kpi.skippedMessages}
          successRate={kpi.successRate}
        />
      </div>
    </div>
  )
}

// ─── Donut components ──────────────────────────────────────────────────────

// Stable palette for channel slices. Xovera doesn't have a per-channel
// brand colour system yet, so this is hand-tuned for visual distinction
// rather than semantic match (only LeadConnector's orange-on-orange would
// have semantic meaning, and that's covered by the accent token).
const CHANNEL_PALETTE: Record<string, string> = {
  SMS:       '#3b82f6',  // blue
  WhatsApp:  '#22c55e',  // green
  FB:        '#1877F2',  // facebook blue
  IG:        '#E4405F',  // instagram pink
  GMB:       '#9ca3af',  // google grey
  Live_Chat: '#8b5cf6',  // violet
  Email:     '#f59e0b',  // amber
}

function ChannelDonut({ breakdown }: { breakdown: { channel: string; agents: number }[] }) {
  const total = breakdown.reduce((sum, c) => sum + c.agents, 0)
  const data = breakdown
    .filter(c => c.agents > 0)
    .map(c => ({
      name: CHANNEL_LABELS[c.channel] ?? c.channel,
      value: c.agents,
      colour: CHANNEL_PALETTE[c.channel] ?? '#6b7280',
    }))

  return (
    <div
      className="xv-card p-4"
    >
      <h3 className="text-[14px] font-semibold text-text-primary mb-3">Channel mix</h3>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-[180px]">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No channels deployed yet</p>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative w-[140px] h-[140px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={62}
                  paddingAngle={2}
                  stroke="var(--surface)"
                  strokeWidth={2}
                >
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.colour} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            {/* Centre label — total agent deployments across channels.
                Absolutely positioned so it sits in the donut hole. */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-xl font-bold leading-none tabular-nums" style={{ color: 'var(--text-primary)' }}>{total}</p>
              <p className="text-[10px] mt-1 uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>deployments</p>
            </div>
          </div>
          <ul className="flex-1 space-y-1.5 min-w-0">
            {data.map(d => (
              <li key={d.name} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.colour }} />
                  <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                </div>
                <span className="tabular-nums shrink-0" style={{ color: 'var(--text-tertiary)' }}>{d.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function OutcomesDonut({
  success, errors, skipped, successRate,
}: { success: number; errors: number; skipped: number; successRate: number }) {
  const total = success + errors + skipped
  const data = [
    { name: 'Successful', value: success, colour: 'var(--accent-emerald)' },
    { name: 'Errors',     value: errors,  colour: 'var(--accent-red)' },
    { name: 'Skipped',    value: skipped, colour: 'var(--text-muted)' },
  ].filter(d => d.value > 0)

  return (
    <div
      className="xv-card p-4"
    >
      <h3 className="text-[14px] font-semibold text-text-primary mb-3">Message outcomes</h3>
      {total === 0 ? (
        <div className="flex items-center justify-center h-[180px]">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No messages yet</p>
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative w-[140px] h-[140px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius={42}
                  outerRadius={62}
                  paddingAngle={2}
                  stroke="var(--surface)"
                  strokeWidth={2}
                >
                  {data.map((entry, i) => (
                    <Cell key={i} fill={entry.colour} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <p className="text-xl font-bold leading-none tabular-nums" style={{ color: 'var(--accent-emerald)' }}>{successRate}%</p>
              <p className="text-[10px] mt-1 uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>success</p>
            </div>
          </div>
          <ul className="flex-1 space-y-1.5 min-w-0">
            {data.map(d => (
              <li key={d.name} className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: d.colour }} />
                  <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{d.name}</span>
                </div>
                <span className="tabular-nums shrink-0" style={{ color: 'var(--text-tertiary)' }}>{formatNum(d.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}


// ─── Greeting / range helpers ──────────────────────────────────────────────

function greeting(firstName: string | null): string {
  const h = new Date().getHours()
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return firstName ? `${part}, ${firstName}` : part
}

function rangeLabel(range: '7d' | '30d' | '90d'): string {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  const end = new Date()
  const start = new Date(end.getTime() - (days - 1) * 86_400_000)
  const f = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${f(start)} – ${f(end)}`
}

// ─── Integration health ────────────────────────────────────────────────────
// Reads the same /connection-health status as the expired-connection banner.
// Only the CRM connection reports health today; other integrations are
// listed on the Integrations page.

function IntegrationHealthCard({ workspaceId }: { workspaceId: string }) {
  const [state, setState] = useState<{ status: string; message: string | null } | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/workspaces/${workspaceId}/connection-health`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setState(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId])

  const bad = state?.status === 'needs_attention'
  return (
    <div className="xv-card p-4">
      <h3 className="text-[14px] font-semibold text-text-primary mb-3">Integration health</h3>
      {state === null ? (
        <p className="text-[12.5px] text-text-muted">Checking…</p>
      ) : state.status === 'not_connected' ? (
        <p className="text-[12.5px] text-text-tertiary">No CRM connected yet.</p>
      ) : bad ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-[13px] font-semibold text-amber-700">CRM connection</p>
          <p className="mt-1 text-[12px] text-amber-700">{state.message}</p>
          <Link href={`/dashboard/${workspaceId}/integrations`} className={buttonClass('primary', 'sm', 'mt-2.5')}>Reconnect</Link>
        </div>
      ) : (
        <div className="flex items-center justify-between text-[13px]">
          <span className="flex items-center gap-2 text-text-primary"><span className="h-2 w-2 rounded-full bg-emerald-500" />CRM connection</span>
          <span className="text-text-tertiary">Healthy</span>
        </div>
      )}
      {/* TODO(redesign-followup): per-integration rows (Twilio, WhatsApp, Shopify, Calendar) with last-sync — needs a health summary across integrations. */}
      <Link href={`/dashboard/${workspaceId}/integrations`} className="mt-3 inline-block text-[12px] font-medium text-brand-500 hover:text-brand-600">All integrations →</Link>
    </div>
  )
}
