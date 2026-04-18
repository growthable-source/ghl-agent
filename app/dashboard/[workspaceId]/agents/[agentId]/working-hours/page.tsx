'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useDirtyForm } from '@/lib/use-dirty-form'
import SaveBar from '@/components/dashboard/SaveBar'

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_LABELS: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}

const COMMON_TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid',
  'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Dubai', 'Asia/Kolkata',
  'Australia/Sydney', 'Pacific/Auckland',
]

interface WH {
  enabled: boolean
  start: number
  end: number
  days: string[]
  timezone: string
}

export default function WorkingHoursPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [initial, setInitial] = useState<WH | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(data => {
        const a = data.agent
        setInitial({
          enabled: !!a?.workingHoursEnabled,
          start: a?.workingHoursStart ?? 9,
          end: a?.workingHoursEnd ?? 17,
          days: a?.workingDays && a.workingDays.length > 0 ? a.workingDays : ['mon','tue','wed','thu','fri'],
          timezone: a?.timezone || 'America/New_York',
        })
      })
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<WH>({
    initial,
    onSave: async (d) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workingHoursEnabled: d.enabled,
          workingHoursStart: d.start,
          workingHoursEnd: d.end,
          workingDays: d.days,
          timezone: d.timezone,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    },
  })

  function toggleDay(day: string) {
    set({ days: draft.days.includes(day) ? draft.days.filter(d => d !== day) : [...draft.days, day] })
  }

  if (loading || !initial) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  const fmt = (h: number) => {
    if (h === 0) return '12am'
    if (h === 12) return '12pm'
    if (h === 24) return '12am (next day)'
    return h < 12 ? `${h}am` : `${h - 12}pm`
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-2xl mx-auto pb-24">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Working Hours</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Restrict when this agent can <strong className="text-zinc-300">proactively reach out</strong>.
            This applies to scheduled follow-ups (auto-shifted to the next valid slot)
            and trigger-fired outbound messages (skipped outside hours).
          </p>
          <p className="text-xs text-zinc-500 mt-2">
            Inbound replies are <em>always</em> sent immediately — your agent will still respond to
            contacts who message during off-hours so they&apos;re not left hanging.
          </p>
        </div>

        <div className="space-y-6">
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                onClick={() => set({ enabled: !draft.enabled })}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                style={{ background: draft.enabled ? '#22c55e' : '#3f3f46' }}
              >
                <span
                  className="inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200"
                  style={{ transform: draft.enabled ? 'translateX(22px)' : 'translateX(4px)' }}
                />
              </button>
              <div>
                <p className="text-sm font-semibold text-white">Enable working hours</p>
                <p className="text-xs text-zinc-400 mt-0.5">When off, the agent can send messages 24/7.</p>
              </div>
            </label>
          </div>

          {draft.enabled && (
            <>
              <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <p className="text-sm font-semibold text-white mb-3">Active hours</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Start</label>
                    <select
                      value={draft.start}
                      onChange={e => set({ start: parseInt(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {Array.from({ length: 24 }).map((_, i) => (
                        <option key={i} value={i}>{fmt(i)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">End</label>
                    <select
                      value={draft.end}
                      onChange={e => set({ end: parseInt(e.target.value) })}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {Array.from({ length: 25 }).map((_, i) => (
                        <option key={i} value={i} disabled={i <= draft.start}>{fmt(i)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 mt-3">
                  Agent will be active from <span className="text-white font-medium">{fmt(draft.start)}</span> to{' '}
                  <span className="text-white font-medium">{fmt(draft.end)}</span>
                </p>
              </div>

              <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <p className="text-sm font-semibold text-white mb-3">Active days</p>
                <div className="grid grid-cols-7 gap-2">
                  {DAY_KEYS.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleDay(day)}
                      className="py-2 rounded-lg text-xs font-medium transition-colors border"
                      style={draft.days.includes(day)
                        ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e', borderColor: 'rgba(250,77,46,0.4)' }
                        : { background: 'rgb(24,24,27)', color: '#71717a', borderColor: 'rgb(39,39,42)' }}
                    >
                      {DAY_LABELS[day]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <p className="text-sm font-semibold text-white mb-3">Timezone</p>
                <select
                  value={draft.timezone}
                  onChange={e => set({ timezone: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  {COMMON_TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
                <p className="text-xs text-zinc-500 mt-2">
                  Working hours are evaluated in this timezone. Consider using the contact&apos;s local zone for SMS-heavy flows.
                </p>
              </div>
            </>
          )}
        </div>

        <SaveBar dirty={dirty} saving={saving} savedAt={savedAt} error={error} onSave={save} onReset={reset} />
      </div>
    </div>
  )
}
