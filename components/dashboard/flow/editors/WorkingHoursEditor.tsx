'use client'

/**
 * Working-hours editor for the side panel (Phase 4 — T8).
 *
 * Working hours are fields directly on the Agent row, so this editor
 * loads the agent, edits the workingHours* fields locally, and saves
 * via PATCH /agents/[agentId]. Mirrors the standalone /working-hours
 * page in a compact form factor — same controls, no embedded SaveBar
 * (the side panel's footer drives save / cancel via EditorHandle).
 */

import { useEffect, useImperativeHandle, useState, forwardRef } from 'react'
import type { BaseEditorProps, EditorHandle } from './types'

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

interface Draft {
  enabled: boolean
  start: number
  end: number
  days: string[]
  timezone: string
}

function fmt(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  if (h === 24) return '12am (next day)'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

function sameDays(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every(d => b.includes(d))
}

export const WorkingHoursEditor = forwardRef<EditorHandle, BaseEditorProps>(function WorkingHoursEditor(
  { workspaceId, agentId, onSaved, onDirtyChange, onSavingChange },
  ref,
) {
  const [loading, setLoading] = useState(true)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`Failed (${r.status})`)))
      .then(data => {
        if (cancelled) return
        const a = data.agent
        const d: Draft = {
          enabled: !!a?.workingHoursEnabled,
          start: a?.workingHoursStart ?? 9,
          end: a?.workingHoursEnd ?? 17,
          days: a?.workingDays && a.workingDays.length > 0 ? a.workingDays : ['mon','tue','wed','thu','fri'],
          timezone: a?.timezone || 'America/New_York',
        }
        setBaseline(d)
        setDraft(d)
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load working hours')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, agentId])

  useEffect(() => {
    if (!baseline || !draft) {
      onDirtyChange(false)
      return
    }
    const dirty =
      baseline.enabled !== draft.enabled
      || baseline.start !== draft.start
      || baseline.end !== draft.end
      || baseline.timezone !== draft.timezone
      || !sameDays(baseline.days, draft.days)
    onDirtyChange(dirty)
  }, [baseline, draft, onDirtyChange])

  useImperativeHandle(ref, () => ({
    async save() {
      if (!draft) return false
      setError(null)
      onSavingChange?.(true)
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workingHoursEnabled: draft.enabled,
            workingHoursStart: draft.start,
            workingHoursEnd: draft.end,
            workingDays: draft.days,
            timezone: draft.timezone,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body?.error ?? `Save failed (${res.status})`)
        }
        setBaseline(draft)
        onSaved()
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed')
        return false
      } finally {
        onSavingChange?.(false)
      }
    },
    cancel() {
      if (baseline) setDraft(baseline)
    },
  }), [draft, baseline, workspaceId, agentId, onSaved, onSavingChange])

  if (loading) {
    return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading working hours…</p>
  }
  if (error && !draft) {
    return <p className="text-xs" style={{ color: 'var(--accent-red, #dc2626)' }}>{error}</p>
  }
  if (!draft) return null

  function toggleDay(day: string) {
    if (!draft) return
    setDraft({
      ...draft,
      days: draft.days.includes(day) ? draft.days.filter(d => d !== day) : [...draft.days, day],
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <p
          className="text-xs rounded px-2 py-1.5"
          style={{
            background: 'var(--accent-red-bg, #fee2e2)',
            color: 'var(--accent-red, #b91c1c)',
          }}
        >
          {error}
        </p>
      )}

      <div
        className="rounded-lg border p-3"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={e => setDraft({ ...draft, enabled: e.target.checked })}
          />
          <span style={{ color: 'var(--text-primary)' }}>
            Restrict to working hours
          </span>
        </label>
        <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
          Applies to proactive sends. Inbound replies are always sent immediately.
        </p>
      </div>

      {draft.enabled && (
        <>
          <div
            className="rounded-lg border p-3 space-y-2"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <label className="text-xs block font-medium" style={{ color: 'var(--text-secondary)' }}>
              Active hours
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-tertiary)' }}>Start</label>
                <select
                  value={draft.start}
                  onChange={e => setDraft({ ...draft, start: parseInt(e.target.value, 10) })}
                  className="w-full text-sm px-2 py-1.5 rounded border"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {Array.from({ length: 24 }).map((_, i) => (
                    <option key={i} value={i}>{fmt(i)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] mb-1 block" style={{ color: 'var(--text-tertiary)' }}>End</label>
                <select
                  value={draft.end}
                  onChange={e => setDraft({ ...draft, end: parseInt(e.target.value, 10) })}
                  className="w-full text-sm px-2 py-1.5 rounded border"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {Array.from({ length: 25 }).map((_, i) => (
                    <option key={i} value={i} disabled={i <= draft.start}>{fmt(i)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div
            className="rounded-lg border p-3 space-y-2"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <label className="text-xs block font-medium" style={{ color: 'var(--text-secondary)' }}>
              Active days
            </label>
            <div className="grid grid-cols-7 gap-1">
              {DAY_KEYS.map(day => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  className="py-1.5 rounded text-[11px] font-medium border"
                  style={
                    draft.days.includes(day)
                      ? {
                          background: 'var(--accent-primary-bg, #dbeafe)',
                          color: 'var(--accent-primary, #2563eb)',
                          borderColor: 'var(--accent-primary, #2563eb)',
                        }
                      : {
                          background: 'var(--surface)',
                          color: 'var(--text-tertiary)',
                          borderColor: 'var(--border)',
                        }
                  }
                >
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          </div>

          <div
            className="rounded-lg border p-3 space-y-2"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <label className="text-xs block font-medium" style={{ color: 'var(--text-secondary)' }}>
              Timezone
            </label>
            <select
              value={draft.timezone}
              onChange={e => setDraft({ ...draft, timezone: e.target.value })}
              className="w-full text-sm px-2 py-1.5 rounded border"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            >
              {COMMON_TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  )
})
