'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
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
    <span className={`text-[11px] font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
      {positive ? '+' : ''}{value}%
    </span>
  )
}

// ─── Custom Recharts Tooltip ────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 shadow-xl text-xs">
      <p className="text-zinc-400 mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-white">
          <span style={{ color: p.color }}>{p.name}:</span> {p.value.toLocaleString()}
        </p>
      ))}
    </div>
  )
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function WorkspaceDashboard() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('7d')
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
          <div className="w-8 h-8 border-2 border-zinc-700 border-t-[#fa4d2e] rounded-full animate-spin mx-auto mb-3" />
          <p className="text-zinc-500 text-sm">Loading analytics...</p>
        </div>
      </div>
    )
  }

  const kpi = data?.kpi
  if (!kpi) return null

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Overview</h1>
          <p className="text-zinc-500 text-xs mt-0.5">Workspace performance at a glance</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Date range selector */}
          <div className="flex items-center gap-0.5 bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
            {(['7d', '30d', '90d'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  range === r ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
                }`}
              >
                {r === '7d' ? '7 days' : r === '30d' ? '30 days' : '90 days'}
              </button>
            ))}
          </div>
          <Link
            href={`/dashboard/${workspaceId}/agents/new`}
            className="text-sm bg-white text-black font-medium px-4 py-1.5 rounded-lg hover:bg-zinc-200 transition-colors"
          >
            + New Agent
          </Link>
        </div>
      </div>

      {/* ─── KPI Cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
        {[
          { label: 'Messages', value: formatNum(kpi.totalMessages), delta: kpi.messagesDelta, icon: '💬' },
          { label: 'Success Rate', value: `${kpi.successRate}%`, delta: kpi.successRateDelta, icon: '✅' },
          { label: 'Active Convos', value: formatNum(kpi.activeConversations), icon: '🔄' },
          { label: 'Appointments', value: kpi.appointmentsBooked.toString(), icon: '📅' },
          { label: 'Voice Calls', value: kpi.callCount.toString(), delta: kpi.callsDelta, icon: '📞' },
          { label: 'Time Saved', value: `${Math.round(kpi.estimatedMinutesSaved / 60)}h`, icon: '⏱️' },
        ].map(card => (
          <div key={card.label} className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm">{card.icon}</span>
              {card.delta !== undefined && <DeltaBadge value={card.delta} />}
            </div>
            <p className="text-xl font-bold text-white">{card.value}</p>
            <p className="text-[11px] text-zinc-500 mt-0.5">{card.label}</p>
          </div>
        ))}
      </div>

      {/* ─── Charts Row ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Messages Over Time */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-sm font-medium text-zinc-300 mb-4">Messages Over Time</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="msgGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#fa4d2e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#fa4d2e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={{ stroke: '#1f2937' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={40}
                />
                <Tooltip content={<ChartTooltip />} />
                <Area
                  type="monotone"
                  dataKey="success"
                  name="Successful"
                  stroke="#fa4d2e"
                  fill="url(#msgGradient)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="errors"
                  name="Errors"
                  stroke="#ef4444"
                  fill="transparent"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Calls & Appointments */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-sm font-medium text-zinc-300 mb-4">Calls & Appointments</h3>
          <div className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={{ stroke: '#1f2937' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="calls" name="Voice Calls" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
                <Bar dataKey="appointments" name="Appointments" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── Agent Performance + Recent Calls ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Agent Breakdown */}
        <div className="lg:col-span-2 rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-zinc-300">Agent Performance</h3>
            <Link href={`/dashboard/${workspaceId}/agents/new`} className="text-xs text-zinc-500 hover:text-white transition-colors">
              + Add Agent
            </Link>
          </div>

          {agents.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-zinc-500 text-sm mb-3">No agents yet</p>
              <Link
                href={`/dashboard/${workspaceId}/agents/new`}
                className="text-sm bg-white text-black font-medium px-4 py-2 rounded-lg hover:bg-zinc-200 transition-colors"
              >
                Create First Agent
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Header row */}
              <div className="grid grid-cols-[1fr_80px_80px_80px_80px_60px] gap-2 px-3 text-[11px] text-zinc-600 font-medium uppercase tracking-wide">
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
                    className="grid grid-cols-[1fr_80px_80px_80px_80px_60px] gap-2 items-center rounded-lg px-3 py-2.5 hover:bg-zinc-900 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{agent.name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        {channels.slice(0, 3).map((ch: string) => (
                          <span key={ch} className="text-[10px] text-zinc-600">
                            {CHANNEL_LABELS[ch] ?? ch}
                          </span>
                        ))}
                        {channels.length > 3 && (
                          <span className="text-[10px] text-zinc-600">+{channels.length - 3}</span>
                        )}
                      </div>
                    </div>
                    <span className="text-sm text-zinc-300 text-right font-medium">
                      {breakdown?.messages || 0}
                    </span>
                    <span className="text-sm text-zinc-300 text-right font-medium">
                      {breakdown?.calls || 0}
                    </span>
                    <span className="text-sm text-zinc-300 text-right font-medium">
                      {breakdown?.appointments || 0}
                    </span>
                    <span className="text-sm text-right font-medium" style={{
                      color: (breakdown?.successRate || 0) >= 90 ? '#10b981'
                        : (breakdown?.successRate || 0) >= 70 ? '#f59e0b' : '#ef4444'
                    }}>
                      {breakdown?.successRate ?? 0}%
                    </span>
                    <div className="flex justify-end">
                      <span className={`w-2 h-2 rounded-full ${agent.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent Voice Calls */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-zinc-300">Recent Calls</h3>
            <Link href={`/dashboard/${workspaceId}/calls`} className="text-xs text-zinc-500 hover:text-white transition-colors">
              View all
            </Link>
          </div>

          {(!data?.recentCalls || data.recentCalls.length === 0) ? (
            <p className="text-zinc-600 text-xs text-center py-6">No calls yet</p>
          ) : (
            <div className="space-y-2">
              {data.recentCalls.slice(0, 6).map(call => (
                <div key={call.id} className="rounded-lg bg-zinc-900/50 border border-zinc-800/50 px-3 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{call.direction === 'inbound' ? '📥' : '📤'}</span>
                      <span className="text-xs text-zinc-300 font-medium">
                        {call.contactPhone || 'Unknown'}
                      </span>
                    </div>
                    <span className="text-[10px] text-zinc-600">{timeAgo(call.createdAt)}</span>
                  </div>
                  {call.summary && (
                    <p className="text-[11px] text-zinc-500 line-clamp-2 mb-1">{call.summary}</p>
                  )}
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={`font-medium ${call.status === 'completed' ? 'text-emerald-500' : 'text-zinc-500'}`}>
                      {call.status}
                    </span>
                    {call.durationSecs != null && (
                      <span className="text-zinc-600">{formatDuration(call.durationSecs)}</span>
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
        {/* Channels */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Active Channels</h3>
          {data?.channelBreakdown && data.channelBreakdown.length > 0 ? (
            <div className="space-y-2">
              {data.channelBreakdown.map(ch => (
                <div key={ch.channel} className="flex items-center justify-between">
                  <span className="text-sm text-zinc-400">{CHANNEL_LABELS[ch.channel] ?? ch.channel}</span>
                  <span className="text-xs text-zinc-500">{ch.agents} agent{ch.agents !== 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-600">No channels deployed yet</p>
          )}
        </div>

        {/* Token Usage */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">AI Usage</h3>
          <div className="space-y-3">
            <div>
              <p className="text-2xl font-bold text-white">{formatNum(kpi.totalTokens)}</p>
              <p className="text-[11px] text-zinc-500">tokens consumed</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-white">{kpi.activeAgents}</p>
              <p className="text-[11px] text-zinc-500">active agents</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-white">{kpi.totalCallMinutes} min</p>
              <p className="text-[11px] text-zinc-500">voice call time</p>
            </div>
          </div>
        </div>

        {/* Error Summary */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
          <h3 className="text-sm font-medium text-zinc-300 mb-3">Message Outcomes</h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm text-zinc-400">Successful</span>
              </div>
              <span className="text-sm text-zinc-300 font-medium">{formatNum(kpi.totalMessages - kpi.errorMessages - kpi.skippedMessages)}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-sm text-zinc-400">Errors</span>
              </div>
              <span className="text-sm text-zinc-300 font-medium">{kpi.errorMessages}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-zinc-500" />
                <span className="text-sm text-zinc-400">Skipped</span>
              </div>
              <span className="text-sm text-zinc-300 font-medium">{kpi.skippedMessages}</span>
            </div>

            {/* Visual bar */}
            {kpi.totalMessages > 0 && (
              <div className="h-2 rounded-full overflow-hidden flex mt-2">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${((kpi.totalMessages - kpi.errorMessages - kpi.skippedMessages) / kpi.totalMessages) * 100}%` }}
                />
                <div
                  className="h-full bg-red-500"
                  style={{ width: `${(kpi.errorMessages / kpi.totalMessages) * 100}%` }}
                />
                <div
                  className="h-full bg-zinc-600"
                  style={{ width: `${(kpi.skippedMessages / kpi.totalMessages) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
