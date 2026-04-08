'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ALL_TOOLS } from '@/lib/tools'

export default function ToolsPage() {
  const params = useParams()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [enabledTools, setEnabledTools] = useState<string[]>([])
  const [calendarId, setCalendarId] = useState('')
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string }>>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setEnabledTools(agent.enabledTools ?? [])
        setCalendarId(agent.calendarId ?? '')
      })
      .finally(() => setLoading(false))

    // Preload calendars
    setLoadingCalendars(true)
    fetch(`/api/locations/${locationId}/calendars`)
      .then(r => r.json())
      .then(({ calendars }) => setCalendars(calendars ?? []))
      .catch(() => {})
      .finally(() => setLoadingCalendars(false))
  }, [locationId, agentId])

  async function toggleTool(toolName: string) {
    const updated = enabledTools.includes(toolName)
      ? enabledTools.filter(t => t !== toolName)
      : [...enabledTools, toolName]
    setEnabledTools(updated)
    await fetch(`/api/locations/${locationId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledTools: updated }),
    })
  }

  async function saveCalendarId(id: string) {
    setCalendarId(id)
    await fetch(`/api/locations/${locationId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calendarId: id }),
    })
  }

  if (loading) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-zinc-500 text-sm">Loading…</p>
    </div>
  )

  const calendarToolsEnabled = (['get_available_slots', 'book_appointment'] as const).some(t => enabledTools.includes(t))

  return (
    <div className="p-8 max-w-2xl space-y-8">
      {(['messaging', 'contacts', 'pipeline', 'calendar', 'intelligence', 'automation'] as const).map(category => {
        const categoryTools = ALL_TOOLS.filter(t => t.category === category)
        if (categoryTools.length === 0) return null
        return (
          <div key={category}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3 capitalize">{category}</h3>
            <div className="space-y-2">
              {categoryTools.map(tool => {
                const isEnabled = enabledTools.includes(tool.name)
                return (
                  <div
                    key={tool.name}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 transition-colors ${
                      isEnabled ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-800'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isEnabled ? 'text-zinc-100' : 'text-zinc-500'}`}>
                        {tool.label}
                      </p>
                      <p className="text-xs text-zinc-600 mt-0.5">{tool.description}</p>
                    </div>
                    <button
                      onClick={() => toggleTool(tool.name)}
                      className={`ml-4 relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        isEnabled ? 'bg-emerald-500' : 'bg-zinc-700'
                      }`}
                      role="switch"
                      aria-checked={isEnabled}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                        isEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                )
              })}
            </div>

            {category === 'calendar' && calendarToolsEnabled && (
              <div className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-4 mt-3">
                <label className="block text-sm font-medium text-zinc-300 mb-1">Connected Calendar</label>
                <p className="text-xs text-zinc-500 mb-3">
                  The agent will use this calendar to check availability and book appointments.
                </p>
                {loadingCalendars ? (
                  <p className="text-sm text-zinc-500">Loading…</p>
                ) : calendars.length === 0 ? (
                  <p className="text-sm text-red-400">No calendars found for this location.</p>
                ) : (
                  <select
                    value={calendarId}
                    onChange={e => saveCalendarId(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
                  >
                    <option value="">Select a calendar…</option>
                    {calendars.map(cal => (
                      <option key={cal.id} value={cal.id}>{cal.name}</option>
                    ))}
                  </select>
                )}
                {calendarId && <p className="text-xs text-zinc-600 mt-2 font-mono">{calendarId}</p>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
