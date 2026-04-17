'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface HeatmapCell { day: number; hour: number; messages: number; wins: number }
interface ChannelRow { channel: string; count: number }
interface GoalRow { agent: { id: string; name: string }; goalName: string; wins: number }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function PerformancePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [goals, setGoals] = useState<GoalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<'messages' | 'wins'>('messages')
  const [days, setDays] = useState(30)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/performance?days=${days}`)
      .then(r => r.json())
      .then(data => {
        setHeatmap(data.heatmap || [])
        setChannels(data.channelBreakdown || [])
        setGoals(data.goalBreakdown || [])
      })
      .finally(() => setLoading(false))
  }, [workspaceId, days])

  const max = useMemo(() => {
    if (heatmap.length === 0) return 1
    return Math.max(...heatmap.map(c => metric === 'messages' ? c.messages : c.wins), 1)
  }, [heatmap, metric])

  const totalChannel = channels.reduce((s, c) => s + c.count, 0) || 1

  const bestHour = useMemo(() => {
    if (heatmap.length === 0) return null
    const best = heatmap.reduce((a, b) => {
      const av = metric === 'messages' ? a.messages : a.wins
      const bv = metric === 'messages' ? b.messages : b.wins
      return bv > av ? b : a
    })
    const val = metric === 'messages' ? best.messages : best.wins
    if (val === 0) return null
    return `${DAYS[best.day]} at ${best.hour}:00 (${val} ${metric})`
  }, [heatmap, metric])

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Performance</h1>
            <p className="text-sm text-zinc-400 mt-1">
              When your agents work best — by day of week, hour, and channel.
            </p>
          </div>
          <div className="flex gap-2">
            <select value={days} onChange={e => setDays(parseInt(e.target.value))}
              className="text-xs bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-white"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </div>
        </div>

        {/* Heatmap */}
        <div className="mb-10 p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-white">Activity heatmap</p>
              {bestHour && <p className="text-xs text-zinc-500 mt-1">Peak: {bestHour}</p>}
            </div>
            <div className="flex gap-1 p-1 rounded-lg bg-zinc-900 border border-zinc-800">
              <button onClick={() => setMetric('messages')}
                className={`text-xs px-3 py-1 rounded-md ${metric === 'messages' ? 'text-white' : 'text-zinc-400'}`}
                style={metric === 'messages' ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
              >
                Messages
              </button>
              <button onClick={() => setMetric('wins')}
                className={`text-xs px-3 py-1 rounded-md ${metric === 'wins' ? 'text-white' : 'text-zinc-400'}`}
                style={metric === 'wins' ? { background: 'rgba(34,197,94,0.12)', color: '#22c55e' } : undefined}
              >
                Appointments
              </button>
            </div>
          </div>

          {/* Hour labels */}
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: '40px repeat(24, 1fr)' }}>
            <div />
            {Array.from({ length: 24 }).map((_, h) => (
              <div key={h} className="text-[9px] text-zinc-600 text-center">
                {h % 3 === 0 ? h : ''}
              </div>
            ))}
            {DAYS.map((day, d) => (
              <div key={day} className="contents">
                <div className="text-[10px] text-zinc-500 self-center pr-2 text-right">{day}</div>
                {Array.from({ length: 24 }).map((_, h) => {
                  const cell = heatmap.find(c => c.day === d && c.hour === h)
                  const val = cell ? (metric === 'messages' ? cell.messages : cell.wins) : 0
                  const intensity = max > 0 ? val / max : 0
                  const color = metric === 'messages' ? '250,77,46' : '34,197,94'
                  return (
                    <div
                      key={h}
                      className="aspect-square rounded-sm transition-colors"
                      style={{
                        background: intensity > 0 ? `rgba(${color}, ${0.15 + intensity * 0.85})` : 'rgb(24,24,27)',
                      }}
                      title={`${DAYS[d]} ${h}:00 — ${val} ${metric}`}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-zinc-500 mt-3 flex items-center gap-2">
            Less
            {[0.1, 0.3, 0.5, 0.7, 0.9].map(o => (
              <div key={o} className="w-3 h-3 rounded-sm"
                style={{ background: `rgba(${metric === 'messages' ? '250,77,46' : '34,197,94'}, ${o})` }}
              />
            ))}
            More
          </p>
        </div>

        {/* Channel breakdown */}
        {channels.length > 0 && (
          <div className="mb-10 p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <p className="text-sm font-semibold text-white mb-4">Follow-ups by channel</p>
            <div className="space-y-2">
              {channels.map(c => {
                const pct = Math.round((c.count / totalChannel) * 100)
                return (
                  <div key={c.channel}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-zinc-300 font-medium">{c.channel}</span>
                      <span className="text-xs text-zinc-500">{c.count} · {pct}%</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: '#fa4d2e' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Goal leaderboard */}
        {goals.length > 0 && (
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <p className="text-sm font-semibold text-white mb-4">Wins by goal</p>
            <div className="space-y-2">
              {goals.map((g, i) => (
                <Link
                  key={`${g.agent.id}-${g.goalName}`}
                  href={`/dashboard/${workspaceId}/agents/${g.agent.id}/goals`}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-800/40 transition-colors"
                >
                  <span className="text-xs font-bold text-zinc-500 w-5">#{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-sm text-white">{g.agent.name}</p>
                    <p className="text-xs text-zinc-500">{g.goalName}</p>
                  </div>
                  <span className="text-lg font-bold text-emerald-400">{g.wins}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
