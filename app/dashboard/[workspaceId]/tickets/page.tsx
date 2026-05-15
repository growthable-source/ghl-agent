'use client'

/**
 * Tickets list page — grid + kanban over the same data, with rich
 * filters (status, priority, brand, assignee, date) and grouping
 * for the grid view. All filter state rides through the API as
 * query params so a deep-link reproduces the exact view.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import KanbanBoard, { type KanbanTicket } from '@/components/tickets/KanbanBoard'
import DateRangePicker, { todayISO, daysAgoISO } from '@/components/csat/DateRangePicker'

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
  brandId: string | null
  brand: { id: string; name: string; primaryColor: string | null } | null
  lastActivityAt: string
  lastInboundAt: string | null
  lastOutboundAt: string | null
  closedAt: string | null
  createdAt: string
  conversationId: string | null
}

interface BrandLite { id: string; name: string; primaryColor: string | null }
interface UserLite  { id: string; name: string | null; email: string | null; image: string | null }

interface ListResponse {
  tickets: Ticket[]
  allBrands: BrandLite[]
  members: UserLite[]
  inactive: boolean
  reason?: 'active' | 'plan_locked' | 'not_enabled' | 'plan_locked_and_not_enabled'
}

const STATUS_COLUMNS: Array<{ key: Ticket['status']; label: string; tone: string }> = [
  { key: 'open',     label: 'Open',     tone: '#3b82f6' },
  { key: 'pending',  label: 'Pending',  tone: '#f59e0b' },
  { key: 'on_hold',  label: 'On hold',  tone: '#a855f7' },
  { key: 'resolved', label: 'Resolved', tone: '#22c55e' },
  { key: 'closed',   label: 'Closed',   tone: '#71717a' },
]

const PRIORITY_TONE: Record<Ticket['priority'], string> = {
  low: '#71717a', normal: '#71717a', high: '#f59e0b', urgent: '#ef4444',
}

type StatusFilter = 'all' | 'open_only' | Ticket['status']
type AssigneeFilter = 'all' | 'me' | 'unassigned' | string // userId
type BrandFilter = 'all' | 'no_brand' | string // brandId
type PriorityFilter = 'all' | Ticket['priority']
type GroupBy = 'none' | 'status' | 'priority' | 'brand' | 'assignee'
type SortBy = 'activity' | 'created' | 'oldest' | 'priority' | 'closed'

export default function TicketsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [data, setData] = useState<ListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'grid' | 'kanban'>('grid')

  const [statusFilter,   setStatusFilter]   = useState<StatusFilter>('open_only')
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilter>('all')
  const [brandFilter,    setBrandFilter]    = useState<BrandFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [groupBy,        setGroupBy]        = useState<GroupBy>('none')
  const [sortBy,         setSortBy]         = useState<SortBy>('activity')

  // Date window — same shape as CSAT (preset OR custom). 'all' = no
  // date filter at all, useful for the everyday "show me everything
  // in flight" view.
  const [dateMode, setDateMode] = useState<'all' | 'preset' | 'custom'>('all')
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [customFrom, setCustomFrom] = useState<string>(daysAgoISO(30))
  const [customTo, setCustomTo] = useState<string>(todayISO())

  const queryString = useMemo(() => {
    const q = new URLSearchParams()
    if (statusFilter !== 'all') q.set('status', statusFilter)
    if (assigneeFilter !== 'all') q.set('assignee', assigneeFilter)
    if (brandFilter !== 'all') q.set('brandId', brandFilter)
    if (priorityFilter !== 'all') q.set('priority', priorityFilter)
    if (sortBy !== 'activity') q.set('sort', sortBy)
    if (dateMode === 'preset') q.set('days', String(days))
    if (dateMode === 'custom') { q.set('from', customFrom); q.set('to', customTo) }
    return q.toString()
  }, [statusFilter, assigneeFilter, brandFilter, priorityFilter, sortBy, dateMode, days, customFrom, customTo])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tickets?${queryString}`)
      const d: ListResponse = await res.json()
      setData(d)
    } finally { setLoading(false) }
  }, [workspaceId, queryString])

  useEffect(() => { load() }, [load])

  const tickets = data?.tickets ?? []
  const grouped = useMemo(() => groupTickets(tickets, groupBy, data?.allBrands ?? [], data?.members ?? []), [tickets, groupBy, data?.allBrands, data?.members])

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
            <div className="flex items-center gap-2 flex-wrap">
              <Link
                href={`/dashboard/${workspaceId}/tickets/reports?${queryString}`}
                className="text-xs font-semibold px-3 py-2 rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                📊 Reports
              </Link>
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
            </div>
          )}
        </div>

        {loading && !data ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
        ) : data?.inactive ? (
          <InactiveState workspaceId={workspaceId} reason={data.reason ?? 'not_enabled'} />
        ) : (
          <>
            {/* ── Status row ─────────────────────────────────────────── */}
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <Chip active={statusFilter === 'open_only'} onClick={() => setStatusFilter('open_only')}>In flight</Chip>
              {STATUS_COLUMNS.map(c => (
                <Chip
                  key={c.key}
                  active={statusFilter === c.key}
                  tone={c.tone}
                  onClick={() => setStatusFilter(c.key)}
                >
                  {c.label}
                </Chip>
              ))}
              <Chip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</Chip>
            </div>

            {/* ── Filter row 2 ───────────────────────────────────────── */}
            <div className="mb-3 flex items-center gap-2 flex-wrap">
              <SectionLabel>Assignee</SectionLabel>
              <Chip active={assigneeFilter === 'all'} onClick={() => setAssigneeFilter('all')}>Everyone</Chip>
              <Chip active={assigneeFilter === 'me'} onClick={() => setAssigneeFilter('me')}>Mine</Chip>
              <Chip active={assigneeFilter === 'unassigned'} onClick={() => setAssigneeFilter('unassigned')}>Unassigned</Chip>
              {data?.members && data.members.length > 0 && (
                <select
                  value={typeof assigneeFilter === 'string' && ['all','me','unassigned'].includes(assigneeFilter) ? '' : assigneeFilter}
                  onChange={e => setAssigneeFilter(e.target.value ? e.target.value : 'all')}
                  className="text-xs rounded-full px-3 py-1"
                  style={{ background: 'var(--surface)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}
                >
                  <option value="">Specific teammate…</option>
                  {data.members.map(m => (
                    <option key={m.id} value={m.id}>{m.name || m.email || m.id.slice(0, 6)}</option>
                  ))}
                </select>
              )}
            </div>

            {/* ── Filter row 3 — brand ─────────────────────────────── */}
            {(data?.allBrands?.length ?? 0) > 0 && (
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <SectionLabel>Brand</SectionLabel>
                <Chip active={brandFilter === 'all'} onClick={() => setBrandFilter('all')}>All brands</Chip>
                {data?.allBrands?.map(b => (
                  <Chip
                    key={b.id}
                    active={brandFilter === b.id}
                    tone={b.primaryColor ?? undefined}
                    onClick={() => setBrandFilter(b.id)}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: b.primaryColor ?? 'var(--text-tertiary)' }} />
                      {b.name}
                    </span>
                  </Chip>
                ))}
                <Chip active={brandFilter === 'no_brand'} onClick={() => setBrandFilter('no_brand')}>(no brand)</Chip>
              </div>
            )}

            {/* ── Filter row 4 — priority + date + sort + group ────── */}
            <div className="mb-4 flex items-center gap-2 flex-wrap">
              <SectionLabel>Priority</SectionLabel>
              <Chip active={priorityFilter === 'all'} onClick={() => setPriorityFilter('all')}>Any</Chip>
              {(['urgent', 'high', 'normal', 'low'] as const).map(p => (
                <Chip key={p} active={priorityFilter === p} tone={PRIORITY_TONE[p]} onClick={() => setPriorityFilter(p)}>
                  {p}
                </Chip>
              ))}

              <span className="mx-1 text-zinc-700">·</span>
              <SectionLabel>Created</SectionLabel>
              <Chip active={dateMode === 'all'} onClick={() => setDateMode('all')}>Any time</Chip>
              <div onClick={() => setDateMode(dateMode === 'all' ? 'preset' : dateMode)} className={dateMode === 'all' ? 'opacity-50' : ''}>
                <DateRangePicker
                  mode={dateMode === 'custom' ? 'custom' : 'preset'}
                  days={days}
                  customFrom={customFrom}
                  customTo={customTo}
                  onPreset={d => { setDateMode('preset'); setDays(d) }}
                  onToggleCustom={() => setDateMode(dateMode === 'custom' ? 'preset' : 'custom')}
                  onCustomFrom={setCustomFrom}
                  onCustomTo={setCustomTo}
                />
              </div>

              <span className="mx-1 text-zinc-700">·</span>
              <SectionLabel>Sort</SectionLabel>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as SortBy)}
                className="text-xs rounded-full px-3 py-1"
                style={{ background: 'var(--surface)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}
              >
                <option value="activity">Latest activity</option>
                <option value="created">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="priority">Highest priority</option>
                <option value="closed">Recently closed</option>
              </select>

              {view === 'grid' && (
                <>
                  <SectionLabel>Group by</SectionLabel>
                  <select
                    value={groupBy}
                    onChange={e => setGroupBy(e.target.value as GroupBy)}
                    className="text-xs rounded-full px-3 py-1"
                    style={{ background: 'var(--surface)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}
                  >
                    <option value="none">— none —</option>
                    <option value="status">Status</option>
                    <option value="priority">Priority</option>
                    <option value="brand">Brand</option>
                    <option value="assignee">Assignee</option>
                  </select>
                </>
              )}
            </div>

            {tickets.length === 0 ? (
              <div className="rounded-xl border p-10 text-center" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="text-3xl mb-2">🎫</div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No tickets match these filters</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Promote a conversation from the inbox, or widen the filters above.
                </p>
              </div>
            ) : view === 'grid' ? (
              groupBy === 'none' ? (
                <GridView tickets={tickets} workspaceId={workspaceId} />
              ) : (
                <GroupedView groups={grouped} workspaceId={workspaceId} />
              )
            ) : (
              <KanbanBoard
                workspaceId={workspaceId}
                tickets={tickets as KanbanTicket[]}
                onChanged={load}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function groupTickets(
  tickets: Ticket[],
  by: GroupBy,
  brands: BrandLite[],
  members: UserLite[],
): Array<{ key: string; label: string; tone?: string; tickets: Ticket[] }> {
  if (by === 'none') return [{ key: '_all', label: 'All', tickets }]
  const map = new Map<string, { key: string; label: string; tone?: string; tickets: Ticket[] }>()
  for (const t of tickets) {
    let key: string
    let label: string
    let tone: string | undefined
    if (by === 'status') {
      key = t.status
      const c = STATUS_COLUMNS.find(s => s.key === t.status)
      label = c?.label ?? t.status
      tone = c?.tone
    } else if (by === 'priority') {
      key = t.priority
      label = t.priority.charAt(0).toUpperCase() + t.priority.slice(1)
      tone = PRIORITY_TONE[t.priority]
    } else if (by === 'brand') {
      key = t.brandId ?? '_no_brand'
      const b = brands.find(x => x.id === t.brandId)
      label = b?.name ?? (t.brand?.name ?? '(no brand)')
      tone = b?.primaryColor ?? t.brand?.primaryColor ?? undefined
    } else {
      // assignee
      key = t.assignedUserId ?? '_unassigned'
      const u = members.find(x => x.id === t.assignedUserId) ?? t.assignedUser
      label = u?.name || u?.email || (t.assignedUserId ? 'Teammate' : 'Unassigned')
    }
    const existing = map.get(key) ?? { key, label, tone, tickets: [] }
    existing.tickets.push(t)
    map.set(key, existing)
  }
  // Sort groups by count desc, then label.
  return Array.from(map.values()).sort((a, b) => b.tickets.length - a.tickets.length || a.label.localeCompare(b.label))
}

function GroupedView({ groups, workspaceId }: { groups: Array<{ key: string; label: string; tone?: string; tickets: Ticket[] }>; workspaceId: string }) {
  return (
    <div className="space-y-5">
      {groups.map(g => (
        <div key={g.key}>
          <div className="flex items-center gap-2 mb-2 px-1">
            {g.tone && <span className="w-1.5 h-1.5 rounded-full" style={{ background: g.tone }} />}
            <span className="text-sm font-semibold" style={{ color: g.tone ?? 'var(--text-primary)' }}>{g.label}</span>
            <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded" style={{ color: 'var(--text-tertiary)', background: 'var(--surface-secondary)' }}>
              {g.tickets.length}
            </span>
          </div>
          <GridView tickets={g.tickets} workspaceId={workspaceId} />
        </div>
      ))}
    </div>
  )
}

function Chip({ active, tone, onClick, children }: { active: boolean; tone?: string; onClick: () => void; children: React.ReactNode }) {
  const accent = tone ?? 'var(--accent-primary)'
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium px-3 py-1 rounded-full transition-colors"
      style={active
        ? { background: tone ? `${tone}1A` : 'var(--accent-primary-bg)', color: accent, border: `1px solid ${accent}` }
        : { background: 'var(--surface)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}
    >
      {children}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] uppercase tracking-wider font-semibold mr-1" style={{ color: 'var(--text-tertiary)' }}>{children}</span>
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
                {t.brand && (
                  <span className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: t.brand.primaryColor ?? 'var(--text-tertiary)' }} />
                    {t.brand.name}
                  </span>
                )}
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

function StatusPill({ status }: { status: Ticket['status'] }) {
  const col = STATUS_COLUMNS.find(c => c.key === status)!
  return (
    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded" style={{ background: `${col.tone}1A`, color: col.tone }}>
      {col.label}
    </span>
  )
}

function PriorityPill({ priority }: { priority: Ticket['priority'] }) {
  const c = PRIORITY_TONE[priority]
  return (
    <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded" style={{ background: `${c}1A`, color: c }}>
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
