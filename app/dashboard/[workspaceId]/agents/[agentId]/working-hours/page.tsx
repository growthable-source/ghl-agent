'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

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

export default function WorkingHoursPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [enabled, setEnabled] = useState(false)
  const [start, setStart] = useState(9)
  const [end, setEnd] = useState(17)
  const [days, setDays] = useState<string[]>(['mon', 'tue', 'wed', 'thu', 'fri'])
  const [timezone, setTimezone] = useState('America/New_York')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [agentName, setAgentName] = useState('')

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(data => {
        const a = data.agent
        setAgentName(a?.name || '')
        setEnabled(!!a?.workingHoursEnabled)
        setStart(a?.workingHoursStart ?? 9)
        setEnd(a?.workingHoursEnd ?? 17)
        setDays(a?.workingDays && a.workingDays.length > 0 ? a.workingDays : ['mon','tue','wed','thu','fri'])
        setTimezone(a?.timezone || 'America/New_York')
      })
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workingHoursEnabled: enabled,
          workingHoursStart: start,
          workingHoursEnd: end,
          workingDays: days,
          timezone,
        }),
      })
      if (res.ok) {
        router.push(`/dashboard/${workspaceId}/agents/${agentId}`)
      }
    } finally { setSaving(false) }
  }

  function toggleDay(day: string) {
    setDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])
  }

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  const fmt = (h: number) => {
    if (h === 0) return '12am'
    if (h === 12) return '12pm'
    if (h === 24) return '12am (next day)'
    return h < 12 ? `${h}am` : `${h - 12}pm`
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-2xl mx-auto">
        <Link
          href={`/dashboard/${workspaceId}/agents/${agentId}`}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mb-4 inline-block"
        >
          ← Back to {agentName || 'agent'}
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Working Hours</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Restrict when this agent can send outbound messages. Scheduled follow-ups
            outside this window auto-shift to the next valid slot.
          </p>
        </div>

        <div className="space-y-6">
          {/* Enable toggle */}
          <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                onClick={() => setEnabled(!enabled)}
                className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
                style={{ background: enabled ? '#22c55e' : '#3f3f46' }}
              >
                <span
                  className="inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200"
                  style={{ transform: enabled ? 'translateX(22px)' : 'translateX(4px)' }}
                />
              </button>
              <div>
                <p className="text-sm font-semibold text-white">Enable working hours</p>
                <p className="text-xs text-zinc-400 mt-0.5">
                  When off, the agent can send messages 24/7.
                </p>
              </div>
            </label>
          </div>

          {enabled && (
            <>
              {/* Hour range */}
              <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <p className="text-sm font-semibold text-white mb-3">Active hours</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-zinc-400 mb-1 block">Start</label>
                    <select
                      value={start}
                      onChange={e => setStart(parseInt(e.target.value))}
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
                      value={end}
                      onChange={e => setEnd(parseInt(e.target.value))}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white"
                    >
                      {Array.from({ length: 25 }).map((_, i) => (
                        <option key={i} value={i} disabled={i <= start}>
                          {fmt(i)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 mt-3">
                  Agent will be active from <span className="text-white font-medium">{fmt(start)}</span> to{' '}
                  <span className="text-white font-medium">{fmt(end)}</span>
                </p>
              </div>

              {/* Days */}
              <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <p className="text-sm font-semibold text-white mb-3">Active days</p>
                <div className="grid grid-cols-7 gap-2">
                  {DAY_KEYS.map(day => (
                    <button
                      key={day}
                      onClick={() => toggleDay(day)}
                      className="py-2 rounded-lg text-xs font-medium transition-colors border"
                      style={days.includes(day)
                        ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e', borderColor: 'rgba(250,77,46,0.4)' }
                        : { background: 'rgb(24,24,27)', color: '#71717a', borderColor: 'rgb(39,39,42)' }}
                    >
                      {DAY_LABELS[day]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timezone */}
              <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <p className="text-sm font-semibold text-white mb-3">Timezone</p>
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
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

          {/* Save */}
          <div className="flex justify-end gap-2">
            <Link
              href={`/dashboard/${workspaceId}/agents/${agentId}`}
              className="text-sm font-medium px-4 py-2.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
            >
              Cancel
            </Link>
            <button
              onClick={save}
              disabled={saving}
              className="text-sm font-medium px-4 py-2.5 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
              style={{ background: '#fa4d2e' }}
            >
              {saving ? 'Saving...' : 'Save working hours'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
