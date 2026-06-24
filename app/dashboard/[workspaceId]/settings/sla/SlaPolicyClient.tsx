'use client'

import { useDirtyForm } from '@/lib/use-dirty-form'
import SaveBar from '@/components/dashboard/SaveBar'

interface SlaPolicy {
  id: string
  workspaceId: string
  priority: string
  firstResponseMins: number | null
  resolutionMins: number | null
  enabled: boolean
}

interface PolicyRow {
  firstResponseMins: number | null
  resolutionMins: number | null
  enabled: boolean
}

type PolicyMap = Record<string, PolicyRow>

const PRIORITY_ROWS: { priority: string; label: string; desc: string }[] = [
  { priority: 'urgent', label: 'Urgent', desc: 'Critical issues needing immediate attention' },
  { priority: 'high', label: 'High', desc: 'Significant problems affecting core functionality' },
  { priority: 'normal', label: 'Normal', desc: 'Standard support requests' },
  { priority: 'low', label: 'Low', desc: 'Minor issues and general questions' },
  { priority: 'default', label: 'Default (fallback)', desc: 'Applied when no priority-specific policy matches' },
]

function minsToHint(mins: number | null): string {
  if (mins === null || mins === 0) return ''
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function policiesToMap(policies: SlaPolicy[]): PolicyMap {
  const map: PolicyMap = {}
  for (const row of PRIORITY_ROWS) {
    const found = policies.find(p => p.priority === row.priority)
    map[row.priority] = found
      ? { firstResponseMins: found.firstResponseMins, resolutionMins: found.resolutionMins, enabled: found.enabled }
      : { firstResponseMins: null, resolutionMins: null, enabled: true }
  }
  return map
}

export default function SlaPolicyClient({
  workspaceId,
  initialPolicies,
}: {
  workspaceId: string
  initialPolicies: SlaPolicy[]
}) {
  const initial = policiesToMap(initialPolicies)

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<PolicyMap>({
    initial,
    onSave: async (d) => {
      const results = await Promise.allSettled(
        PRIORITY_ROWS.map(({ priority }) => {
          const row = d[priority]
          return fetch(`/api/workspaces/${workspaceId}/sla-policies`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              priority,
              firstResponseMins: row.firstResponseMins || null,
              resolutionMins: row.resolutionMins || null,
              enabled: row.enabled,
            }),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json()
              throw new Error(data.error || `Failed to save ${priority}`)
            }
          })
        }),
      )
      const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[]
      if (failed.length > 0) throw new Error(failed[0].reason?.message || 'Failed to save')
    },
  })

  function setRow(priority: string, patch: Partial<PolicyRow>) {
    set({ [priority]: { ...draft[priority], ...patch } })
  }

  function parseMinutes(val: string): number | null {
    const n = parseInt(val, 10)
    return isNaN(n) || n <= 0 ? null : n
  }

  return (
    <div className="space-y-3 pb-24">
      {/* Header row */}
      <div className="grid grid-cols-[1fr_120px_120px_56px] gap-3 px-4 pb-1">
        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Priority</span>
        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>First response</span>
        <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Resolution</span>
        <span className="text-[11px] uppercase tracking-wider font-semibold text-center" style={{ color: 'var(--text-tertiary)' }}>On</span>
      </div>

      {PRIORITY_ROWS.map(({ priority, label, desc }) => {
        const row = draft[priority] ?? { firstResponseMins: null, resolutionMins: null, enabled: true }
        return (
          <div
            key={priority}
            className="rounded-xl border p-4 grid grid-cols-[1fr_120px_120px_56px] gap-3 items-center"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {/* Label */}
            <div>
              <p className="text-sm font-medium" style={{ color: row.enabled ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
                {label}
              </p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{desc}</p>
            </div>

            {/* First response */}
            <div>
              <input
                type="number"
                min={1}
                placeholder="—"
                value={row.firstResponseMins ?? ''}
                onChange={e => setRow(priority, { firstResponseMins: parseMinutes(e.target.value) })}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
              />
              {row.firstResponseMins !== null && row.firstResponseMins > 0 && (
                <p className="text-[10px] mt-0.5 text-center" style={{ color: 'var(--text-muted)' }}>
                  {minsToHint(row.firstResponseMins)}
                </p>
              )}
            </div>

            {/* Resolution */}
            <div>
              <input
                type="number"
                min={1}
                placeholder="—"
                value={row.resolutionMins ?? ''}
                onChange={e => setRow(priority, { resolutionMins: parseMinutes(e.target.value) })}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
              />
              {row.resolutionMins !== null && row.resolutionMins > 0 && (
                <p className="text-[10px] mt-0.5 text-center" style={{ color: 'var(--text-muted)' }}>
                  {minsToHint(row.resolutionMins)}
                </p>
              )}
            </div>

            {/* Enabled toggle */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setRow(priority, { enabled: !row.enabled })}
                className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
                style={{ background: row.enabled ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
                aria-label={row.enabled ? 'Disable' : 'Enable'}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full shadow transition ${row.enabled ? 'translate-x-4' : 'translate-x-0'}`}
                  style={{ background: '#fff' }}
                />
              </button>
            </div>
          </div>
        )
      })}

      <p className="text-xs px-1" style={{ color: 'var(--text-muted)' }}>
        Target times are in minutes. Blank means the metric is not tracked for that priority.
      </p>

      <SaveBar dirty={dirty} saving={saving} savedAt={savedAt} error={error} onSave={save} onReset={reset} />
    </div>
  )
}
