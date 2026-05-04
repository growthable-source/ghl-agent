'use client'

/**
 * Reflexes — tools the model is allowed to call freely during a
 * conversation. Reads, replies, calendar coordination, handover.
 *
 * Write-actions that mutate CRM state (change pipeline stage, set deal
 * value, enrol in workflow, etc.) used to live here as toggles. They
 * moved to Playbook so the operator authors a "when X, do Y" rule
 * instead of letting the model decide.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  REFLEXES,
  REFLEX_GROUP_LABEL,
  REFLEX_GROUP_ORDER,
} from '@/lib/agent-tools-catalog'

export default function ReflexesPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [enabledTools, setEnabledTools] = useState<string[]>([])
  const [calendarId, setCalendarId] = useState('')
  const [calendars, setCalendars] = useState<Array<{ id: string; name: string }>>([])
  const [loadingCalendars, setLoadingCalendars] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setEnabledTools(agent.enabledTools ?? [])
        setCalendarId(agent.calendarId ?? '')
      })
      .finally(() => setLoading(false))

    setLoadingCalendars(true)
    fetch(`/api/workspaces/${workspaceId}/calendars`)
      .then(r => r.json())
      .then(({ calendars }) => setCalendars(calendars ?? []))
      .catch(() => {})
      .finally(() => setLoadingCalendars(false))
  }, [workspaceId, agentId])

  async function toggleReflex(key: string) {
    const updated = enabledTools.includes(key)
      ? enabledTools.filter(t => t !== key)
      : [...enabledTools, key]
    setEnabledTools(updated)
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabledTools: updated }),
    })
  }

  async function saveCalendarId(id: string) {
    setCalendarId(id)
    // Auto-enable booking reflexes when a calendar is selected. Without
    // them, setting a calendar ID is a no-op.
    const autoEnable = ['get_available_slots', 'book_appointment', 'create_appointment_note']
    const missing = autoEnable.filter(t => !enabledTools.includes(t))
    const updatedTools = missing.length > 0 ? [...enabledTools, ...missing] : enabledTools
    if (missing.length > 0) setEnabledTools(updatedTools)
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarId: id,
        ...(missing.length > 0 ? { enabledTools: updatedTools } : {}),
      }),
    })
  }

  if (loading) {
    return (
      <div className="p-8 max-w-2xl">
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="h-20 rounded-xl animate-pulse"
              style={{ background: 'var(--surface-tertiary)' }}
            />
          ))}
        </div>
      </div>
    )
  }

  const calendarReflexesOn = ['get_available_slots', 'book_appointment'].some(t => enabledTools.includes(t))

  return (
    <div className="p-8 max-w-2xl space-y-6">
      {/* Top explainer — sets up the Reflex vs Playbook split */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Reflexes
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          These are the tools the agent uses naturally during a conversation —
          looking up contacts, replying, coordinating bookings. The model
          decides when each is appropriate.
        </p>
        <p className="text-xs leading-relaxed mt-2" style={{ color: 'var(--text-tertiary)' }}>
          Anything that <em>changes</em> CRM state (pipeline stages, deal
          values, workflow enrolments) lives in{' '}
          <Link
            href={`/dashboard/${workspaceId}/agents/${agentId}/playbook`}
            className="font-medium hover:opacity-80"
            style={{ color: 'var(--accent-primary)' }}
          >
            Playbook
          </Link>{' '}
          — there you author "when X happens, do Y" so the agent only mutates
          your data deliberately.
        </p>
      </div>

      {REFLEX_GROUP_ORDER.map(group => {
        const groupReflexes = REFLEXES.filter(r => r.group === group)
        if (groupReflexes.length === 0) return null
        return (
          <div key={group}>
            <h3
              className="text-[11px] font-semibold uppercase tracking-wider mb-2.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              {REFLEX_GROUP_LABEL[group]}
            </h3>
            <div className="space-y-2">
              {groupReflexes.map(reflex => {
                const isOn = enabledTools.includes(reflex.key) || reflex.required
                const locked = reflex.required
                return (
                  <div
                    key={reflex.key}
                    className="flex items-center justify-between gap-4 rounded-xl border p-3.5 transition-colors"
                    style={{
                      borderColor: isOn ? 'var(--border)' : 'var(--border-secondary)',
                      background: 'var(--surface)',
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium"
                        style={{ color: isOn ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                      >
                        {reflex.label}
                        {locked && (
                          <span
                            className="ml-2 text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
                          >
                            Required
                          </span>
                        )}
                      </p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        {reflex.description}
                      </p>
                    </div>
                    <button
                      onClick={() => !locked && toggleReflex(reflex.key)}
                      disabled={locked}
                      className="relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ background: isOn ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
                      role="switch"
                      aria-checked={isOn}
                      title={locked ? 'Required — the agent cannot function without this' : undefined}
                    >
                      <span
                        className="pointer-events-none inline-block h-5 w-5 transform rounded-full shadow transition-transform"
                        style={{
                          background: 'var(--btn-primary-text)',
                          transform: isOn ? 'translateX(20px)' : 'translateX(0)',
                        }}
                      />
                    </button>
                  </div>
                )
              })}
            </div>

            {/* Calendar config card lives under the Calendar group */}
            {group === 'calendar' && (
              <div
                className="mt-3 rounded-xl border p-4"
                style={{
                  borderColor: calendarId
                    ? 'var(--accent-emerald)'
                    : calendarReflexesOn
                      ? 'var(--accent-amber)'
                      : 'var(--border)',
                  background: calendarId
                    ? 'var(--accent-emerald-bg)'
                    : calendarReflexesOn
                      ? 'var(--accent-amber-bg)'
                      : 'var(--surface)',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    Connected calendar
                  </p>
                  {calendarId && (
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
                    >
                      Configured
                    </span>
                  )}
                  {!calendarId && calendarReflexesOn && (
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
                    >
                      Required
                    </span>
                  )}
                </div>
                <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                  {calendarId
                    ? 'The agent will use this calendar to check availability and book appointments.'
                    : calendarReflexesOn
                      ? 'Booking reflexes are on but no calendar is selected — pick one or the agent will say it booked without anything happening.'
                      : 'Pick a calendar to enable booking. The booking reflexes turn on automatically.'}
                </p>
                {loadingCalendars ? (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
                ) : calendars.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--accent-amber)' }}>
                    No calendars found in this location. Create one in LeadConnector first, then come back.
                  </p>
                ) : (
                  <select
                    value={calendarId}
                    onChange={e => saveCalendarId(e.target.value)}
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={{
                      background: 'var(--input-bg)',
                      color: 'var(--input-text)',
                      border: '1px solid var(--input-border)',
                    }}
                  >
                    <option value="">Select a calendar…</option>
                    {calendars.map(cal => (
                      <option key={cal.id} value={cal.id}>{cal.name}</option>
                    ))}
                  </select>
                )}
                {calendarId && (
                  <p className="text-[11px] mt-2 font-mono" style={{ color: 'var(--text-tertiary)' }}>
                    {calendarId}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
