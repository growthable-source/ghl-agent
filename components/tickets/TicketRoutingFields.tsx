'use client'

/**
 * Shared "Ticket routing" fieldset — used by the brand editor modal
 * (per-brand routing) and the ticketing settings page (workspace
 * default for tickets without a brand). Renders the three-way mode
 * choice plus the member picker the chosen mode needs; the parent owns
 * the values and persists them (Brand.ticketRouting* or
 * TicketingSettings.defaultTicketRouting*).
 *
 * Fetches the member roster itself so both call sites stay drop-in.
 * Viewers are filtered out — the router never assigns to them
 * (lib/ticket-routing.ts) and offering them here would only create
 * config the server rejects.
 */

import { useEffect, useState } from 'react'

export interface TicketRoutingValue {
  mode: 'manual' | 'single' | 'pool'
  assigneeUserId: string | null
  poolUserIds: string[]
}

interface Member {
  userId: string
  label: string
}

const MODE_OPTIONS: Array<{ value: TicketRoutingValue['mode']; label: string; hint: string }> = [
  { value: 'manual', label: 'Leave unassigned', hint: 'Tickets wait in the queue until someone claims them.' },
  { value: 'single', label: 'Assign to one person', hint: 'Every ticket goes straight to the designated owner.' },
  { value: 'pool', label: 'Route to a pool', hint: 'Round-robin across the selected teammates (none selected = everyone).' },
]

export default function TicketRoutingFields({
  workspaceId, value, onChange,
}: {
  workspaceId: string
  value: TicketRoutingValue
  onChange: (v: TicketRoutingValue) => void
}) {
  const [members, setMembers] = useState<Member[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/workspaces/${workspaceId}/members`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        type MemberRow = { role: string; user: { id: string; name: string | null; email: string | null } | null }
        const rows: MemberRow[] = Array.isArray(d.members) ? d.members : []
        setMembers(rows
          .filter(m => m.role !== 'viewer' && m.user?.id)
          .map(m => ({ userId: m.user!.id, label: m.user!.name || m.user!.email || m.user!.id })))
      })
      .catch(() => { if (!cancelled) setMembers([]) })
    return () => { cancelled = true }
  }, [workspaceId])

  const memberIds = new Set((members ?? []).map(m => m.userId))
  const staleAssignee = value.mode === 'single' && value.assigneeUserId && members !== null && !memberIds.has(value.assigneeUserId)
  const stalePoolIds = value.mode === 'pool' && members !== null
    ? value.poolUserIds.filter(id => !memberIds.has(id))
    : []

  return (
    <div>
      <label className="text-[11px] uppercase tracking-wider font-semibold block mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
        Ticket routing
      </label>
      <div className="space-y-1.5">
        {MODE_OPTIONS.map(opt => (
          <label
            key={opt.value}
            className="flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer"
            style={{
              border: `1px solid ${value.mode === opt.value ? 'var(--accent-primary)' : 'var(--border)'}`,
              background: 'var(--surface-secondary)',
            }}
          >
            <input
              type="radio"
              name="ticket-routing-mode"
              checked={value.mode === opt.value}
              onChange={() => onChange({ ...value, mode: opt.value })}
              className="mt-0.5 accent-orange-500"
            />
            <span className="flex-1">
              <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
              <span className="block text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {value.mode === 'single' && (
        <div className="mt-2">
          <select
            value={value.assigneeUserId ?? ''}
            onChange={e => onChange({ ...value, assigneeUserId: e.target.value || null })}
            className="w-full rounded px-3 py-2 text-sm"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
          >
            <option value="">Choose a teammate…</option>
            {(members ?? []).map(m => (
              <option key={m.userId} value={m.userId}>{m.label}</option>
            ))}
          </select>
          {staleAssignee && (
            <p className="text-[10px] mt-1 text-amber-400">
              The configured assignee is no longer an eligible member — tickets will land unassigned until you pick someone else.
            </p>
          )}
          {members !== null && !value.assigneeUserId && (
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Nobody chosen yet — tickets stay unassigned until you pick someone.
            </p>
          )}
        </div>
      )}

      {value.mode === 'pool' && (
        <div className="mt-2 space-y-1 max-h-40 overflow-y-auto p-2 rounded-lg" style={{ border: '1px solid var(--border)', background: 'var(--input-bg)' }}>
          {members === null && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Loading teammates…</p>
          )}
          {members !== null && members.length === 0 && (
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No eligible teammates found.</p>
          )}
          {(members ?? []).map(m => (
            <label key={m.userId} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input
                type="checkbox"
                className="accent-orange-500"
                checked={value.poolUserIds.includes(m.userId)}
                onChange={e => onChange({
                  ...value,
                  poolUserIds: e.target.checked
                    ? [...value.poolUserIds, m.userId]
                    : value.poolUserIds.filter(id => id !== m.userId),
                })}
              />
              {m.label}
            </label>
          ))}
          {members !== null && value.poolUserIds.length === 0 && members.length > 0 && (
            <p className="text-[10px] pt-1" style={{ color: 'var(--text-muted)' }}>
              Nobody checked = round-robin across everyone above.
            </p>
          )}
          {stalePoolIds.length > 0 && (
            <p className="text-[10px] pt-1 text-amber-400">
              {stalePoolIds.length} configured member{stalePoolIds.length === 1 ? ' is' : 's are'} no longer in the workspace and will be skipped.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
