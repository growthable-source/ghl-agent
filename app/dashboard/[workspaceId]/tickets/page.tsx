'use client'

/**
 * Tickets list page — kanban + grid views over the same data.
 *
 * Two states the page can be in:
 *   - Ticketing inactive (plan locked or workspace toggle off) →
 *     show a gated empty state with a link to the settings page.
 *   - Active → list view with status filter + assignee filter +
 *     view-mode toggle (grid / kanban).
 *
 * Kanban view is drag-free for v1; status changes via a status pill
 * dropdown on each card. Drag-to-move is a polish pass.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Ticket {
  id: string
  ticketNumber: number
  subject: string
  status: 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  contactEmail: string
  contactName: string | null
  assignedUserId: string | null
  assignedUser: { id: string; name: string | null; email: string | null; image: string | null } | null
  lastActivityAt: string
  lastInboundAt: string | null
  lastOutboundAt: string | null
  closedAt: string | null
  createdAt: string
  conversationId: string | null
}

interface ListResponse {
  tickets: Ticket[]
  inactive: boolean
  reason?: 'active' | 'plan_locked' | 'not_enabled' | 'plan_locked_and_not_enabled'
}

const KANBAN_COLUMNS: Array<{ key: Ticket['status']; label: string; tone: string }> = [
  { key: 'open',     label: 'Open',     tone: '#3b82f6' },
  { key: 'pending',  label: 'Pending',  tone: '#f59e0b' },
  { key: 'on_hold',  label: 'On hold',  tone: '#a855f7' },
  { key: 'resolved', label: 'Resolved', tone: '#22c55e' },
  { key: 'closed',   label: 'Closed',   tone: '#71717a' },
]

export default function TicketsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'grid' | 'kanban'>('grid')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open_only' | Ticket['status']>('open_only')
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'me' | 'unassigned'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    const q = new URLSearchParams()
    if (statusFilter !== 'all') q.set('status', statusFilter)
    if (assigneeFilter !== 'all') q.set('assignee', assigneeFilter)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tickets?${q.toString()}`)
      const d: ListResponse = await res.json()
      setData(d)
    } finally { setLoading(false) }
  }, [workspaceId, statusFilter, assigneeFilter])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Tickets</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Email-driven cases promoted from chats or created from scratch.
            </p>
          </div>
          {!data?.inactive && (
            <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
              {(['grid', 'kanban'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className="text-xs font-medium px-3 py-1 rounded-md transition-colors capitalize"
                  style={view === v
                    ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                    : { color: 'var(--text-tertiary)' }}
                >
                  {v === 'grid' ? '☷ Grid' : '☰ Kanban'}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
        ) : data?.inactive ? (
          <InactiveState workspaceId={workspaceId} reason={data.reason ?? 'not_enabled'} />
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <FilterChip
                active={statusFilter === 'open_only'}
                onClick={() => setStatusFilter('open_only')}
              >
                In flight
              </FilterChip>
              {KANBAN_COLUMNS.map(c => (
                <FilterChip
                  key={c.key}
                  active={statusFilter === c.key}
                  onClick={() => setStatusFilter(c.key)}
                >
                  {c.label}
                </FilterChip>
              ))}
              <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</FilterChip>
              <span className="mx-3 text-zinc-700">·</span>
              <FilterChip active={assigneeFilter === 'all'} onClick={() => setAssigneeFilter('all')}>Everyone</FilterChip>
              <FilterChip active={assigneeFilter === 'me'} onClick={() => setAssigneeFilter('me')}>Mine</FilterChip>
              <FilterChip active={assigneeFilter === 'unassigned'} onClick={() => setAssigneeFilter('unassigned')}>Unassigned</FilterChip>
            </div>

            {data?.tickets.length === 0 ? (
              <div className="rounded-xl border p-10 text-center" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="text-3xl mb-2">🎫</div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No tickets match these filters</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Promote a conversation from the inbox to create your first ticket.
                </p>
              </div>
            ) : view === 'grid' ? (
              <GridView tickets={data?.tickets ?? []} workspaceId={workspaceId} />
            ) : (
              <KanbanView tickets={data?.tickets ?? []} workspaceId={workspaceId} onChange={load} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium px-3 py-1 rounded-full transition-colors"
      style={active
        ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)' }
        : { background: 'var(--surface)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}
    >
      {children}
    </button>
  )
}

function GridView({ tickets, workspaceId }: { tickets: Ticket[]; workspaceId: string }) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      {tickets.map(t => (
        <Link
          key={t.id}
          href={`/dashboard/${workspaceId}/tickets/${t.id}`}
          className="block p-4 border-t first:border-t-0 hover:bg-zinc-900/40 transition-colors"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-start gap-3">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
              #{t.ticketNumber}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{t.subject}</p>
                <StatusPill status={t.status} />
                {t.priority !== 'normal' && <PriorityPill priority={t.priority} />}
                {t.conversationId && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300">from chat</span>}
              </div>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                {t.contactName || t.contactEmail} · {timeAgo(t.lastActivityAt)}
              </p>
            </div>
            {t.assignedUser ? (
              t.assignedUser.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.assignedUser.image} alt="" className="w-6 h-6 rounded-full shrink-0" />
              ) : (
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-semibold flex items-center justify-center shrink-0">
                  {(t.assignedUser.name || t.assignedUser.email || '?').charAt(0).toUpperCase()}
                </span>
              )
            ) : (
              <span className="text-[10px] text-zinc-600 shrink-0">unassigned</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}

function KanbanView({ tickets, workspaceId, onChange }: { tickets: Ticket[]; workspaceId: string; onChange: () => void }) {
  const grouped: Record<Ticket['status'], Ticket[]> = { open: [], pending: [], on_hold: [], resolved: [], closed: [] }
  for (const t of tickets) grouped[t.status]?.push(t)
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
      {KANBAN_COLUMNS.map(col => (
        <div key={col.key} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold" style={{ color: col.tone }}>{col.label}</span>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{grouped[col.key].length}</span>
          </div>
          <div className="space-y-2">
            {grouped[col.key].map(t => (
              <KanbanCard key={t.id} ticket={t} workspaceId={workspaceId} onChange={onChange} />
            ))}
            {grouped[col.key].length === 0 && (
              <p className="text-[10px] text-center py-4" style={{ color: 'var(--text-tertiary)' }}>—</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function KanbanCard({ ticket, workspaceId, onChange }: { ticket: Ticket; workspaceId: string; onChange: () => void }) {
  async function changeStatus(next: Ticket['status']) {
    if (next === ticket.status) return
    await fetch(`/api/workspaces/${workspaceId}/tickets/${ticket.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    onChange()
  }
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
      <div className="flex items-start gap-2 mb-1">
        <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--text-tertiary)' }}>#{ticket.ticketNumber}</span>
        {ticket.priority !== 'normal' && <PriorityPill priority={ticket.priority} />}
      </div>
      <Link
        href={`/dashboard/${workspaceId}/tickets/${ticket.id}`}
        className="text-xs font-medium block hover:underline line-clamp-2 mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {ticket.subject}
      </Link>
      <p className="text-[10px] truncate mb-2" style={{ color: 'var(--text-tertiary)' }}>
        {ticket.contactName || ticket.contactEmail}
      </p>
      <div className="flex items-center justify-between gap-2">
        <select
          value={ticket.status}
          onChange={e => changeStatus(e.target.value as Ticket['status'])}
          className="text-[10px] rounded px-1 py-0.5"
          style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
        >
          {KANBAN_COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{timeAgo(ticket.lastActivityAt)}</span>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: Ticket['status'] }) {
  const col = KANBAN_COLUMNS.find(c => c.key === status)!
  return (
    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded" style={{ background: `${col.tone}1A`, color: col.tone }}>
      {col.label}
    </span>
  )
}

function PriorityPill({ priority }: { priority: Ticket['priority'] }) {
  const colors: Record<Ticket['priority'], string> = {
    low: '#71717a', normal: '#71717a', high: '#f59e0b', urgent: '#ef4444',
  }
  return (
    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded" style={{ background: `${colors[priority]}1A`, color: colors[priority] }}>
      {priority}
    </span>
  )
}

function InactiveState({ workspaceId, reason }: { workspaceId: string; reason: string }) {
  const planLocked = reason === 'plan_locked' || reason === 'plan_locked_and_not_enabled'
  return (
    <div className="rounded-xl border p-10 text-center" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="text-3xl mb-2">🎫</div>
      <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        {planLocked ? 'Ticketing is a Scale plan feature' : 'Ticketing is off for this workspace'}
      </p>
      <p className="text-sm mb-4 max-w-md mx-auto" style={{ color: 'var(--text-tertiary)' }}>
        {planLocked
          ? 'Promote chats to tickets, manage them in kanban or grid, draft email replies with your AI agent, and auto-close stale ones. Upgrade to Scale to enable.'
          : 'Open the ticketing settings to turn it on. Once enabled, you can promote any conversation from the inbox into a ticket.'}
      </p>
      <Link
        href={planLocked ? `/dashboard/${workspaceId}/settings/billing` : `/dashboard/${workspaceId}/settings/ticketing`}
        className="inline-block text-sm font-semibold px-4 py-2 rounded-lg"
        style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
      >
        {planLocked ? 'See plans' : 'Open ticketing settings'}
      </Link>
    </div>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
