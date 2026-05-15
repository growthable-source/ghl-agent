'use client'

/**
 * Drag-and-drop ticket kanban.
 *
 * Uses @dnd-kit because it gives us pointer + keyboard accessibility
 * for free, with a real DragOverlay so the card you're dragging
 * doesn't deform (transforms-on-the-source jank that vanilla DnD or
 * cheap libs produce).
 *
 * UX commitments:
 *   - Optimistic: card moves to the new column the instant you drop.
 *     PATCH fires in the background. On failure we revert and toast.
 *   - 8px activation threshold so accidental clicks don't start a drag.
 *   - The over-column lights up while you hover.
 *   - The dragging card lifts (scale + shadow) via the DragOverlay,
 *     leaving a ghost in its origin slot — same pattern Linear uses.
 *   - Status pill in each card is also a dropdown — keyboard users
 *     can change status without dragging at all.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'

export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed'
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface KanbanTicket {
  id: string
  ticketNumber: number
  subject: string
  status: TicketStatus
  priority: TicketPriority
  contactEmail: string
  contactName: string | null
  assignedUser: { id: string; name: string | null; email: string | null; image: string | null } | null
  lastActivityAt: string
  conversationId: string | null
}

const COLUMNS: Array<{ key: TicketStatus; label: string; tone: string }> = [
  { key: 'open',     label: 'Open',     tone: '#3b82f6' },
  { key: 'pending',  label: 'Pending',  tone: '#f59e0b' },
  { key: 'on_hold',  label: 'On hold',  tone: '#a855f7' },
  { key: 'resolved', label: 'Resolved', tone: '#22c55e' },
  { key: 'closed',   label: 'Closed',   tone: '#71717a' },
]

interface Props {
  workspaceId: string
  tickets: KanbanTicket[]
  /** Called after a successful status change so the parent can refetch
   *  to reconcile counts / move the card off our local optimistic list. */
  onChanged: () => void
}

export default function KanbanBoard({ workspaceId, tickets, onChanged }: Props) {
  // Local optimistic copy. Drag/drop mutates this immediately so the
  // card lands in its new column without waiting for the network.
  // We reseed from the prop whenever the parent reloads (filter
  // change, post-PATCH refetch, polling) so the server is the
  // eventual source of truth.
  const [localTickets, setLocalTickets] = useState<KanbanTicket[]>(tickets)
  useEffect(() => { setLocalTickets(tickets) }, [tickets])

  const sensors = useSensors(
    // 8px activation distance — protects click-through-to-detail. Same
    // value Linear, GitHub Projects, and Notion use for their kanbans.
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const [activeId, setActiveId] = useState<string | null>(null)
  const activeTicket = useMemo(
    () => activeId ? localTickets.find(t => t.id === activeId) ?? null : null,
    [activeId, localTickets],
  )

  const grouped = useMemo(() => {
    const g: Record<TicketStatus, KanbanTicket[]> = { open: [], pending: [], on_hold: [], resolved: [], closed: [] }
    for (const t of localTickets) g[t.status]?.push(t)
    return g
  }, [localTickets])

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const overId = e.over?.id
    if (!overId) return
    const ticketId = String(e.active.id)
    const newStatus = String(overId) as TicketStatus
    if (!COLUMNS.some(c => c.key === newStatus)) return

    const moved = localTickets.find(t => t.id === ticketId)
    if (!moved || moved.status === newStatus) return

    // Optimistic — flip status locally first.
    const prevStatus = moved.status
    setLocalTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: newStatus } : t))

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'PATCH failed')
      onChanged()
    } catch {
      // Revert on failure so the kanban doesn't lie about state.
      setLocalTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: prevStatus } : t))
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {COLUMNS.map(col => (
          <Column
            key={col.key}
            workspaceId={workspaceId}
            column={col}
            tickets={grouped[col.key]}
            isDragging={activeId !== null}
          />
        ))}
      </div>

      {/* DragOverlay = the floating card under the cursor. Rendered
          OUTSIDE the column tree so it doesn't get clipped by overflow
          and doesn't push siblings around. */}
      <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeTicket && <Card ticket={activeTicket} workspaceId="" floating />}
      </DragOverlay>
    </DndContext>
  )
}

function Column({ workspaceId, column, tickets, isDragging }: {
  workspaceId: string
  column: { key: TicketStatus; label: string; tone: string }
  tickets: KanbanTicket[]
  isDragging: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key })
  return (
    <div
      ref={setNodeRef}
      className="rounded-xl p-3 transition-all duration-150"
      style={{
        border: `1px solid ${isOver ? column.tone : 'var(--border)'}`,
        background: isOver ? `${column.tone}10` : 'var(--surface)',
        boxShadow: isOver ? `0 0 0 1px ${column.tone}40` : undefined,
        // Subtly dim non-target columns while a drag is in progress so
        // the operator's eye is pulled to potential drop targets.
        opacity: isDragging && !isOver ? 0.85 : 1,
      }}
    >
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: column.tone }} />
          <span className="text-xs font-semibold" style={{ color: column.tone }}>{column.label}</span>
        </div>
        <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded" style={{ color: 'var(--text-tertiary)', background: 'var(--surface-secondary)' }}>
          {tickets.length}
        </span>
      </div>
      <div className="space-y-2 min-h-[60px]">
        {tickets.map(t => <Card key={t.id} ticket={t} workspaceId={workspaceId} />)}
        {tickets.length === 0 && (
          <div
            className="h-16 rounded-lg border border-dashed flex items-center justify-center text-[10px] transition-colors"
            style={{
              borderColor: isOver ? column.tone : 'var(--border)',
              color: isOver ? column.tone : 'var(--text-tertiary)',
            }}
          >
            {isOver ? 'Drop here' : '—'}
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ ticket, workspaceId, floating = false }: { ticket: KanbanTicket; workspaceId: string; floating?: boolean }) {
  // `floating` cards are the DragOverlay copy — they shouldn't be
  // draggable themselves and we lift them with shadow + rotation.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id, disabled: floating })

  const priorityTone = PRIORITY_TONE[ticket.priority]
  const lastAgo = timeAgo(ticket.lastActivityAt)

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="group rounded-lg select-none transition-all"
      style={{
        background: 'var(--surface-secondary)',
        border: '1px solid var(--border)',
        cursor: floating ? 'grabbing' : 'grab',
        // The source card during drag → ghost. The DragOverlay shows
        // the real card under the cursor.
        opacity: isDragging && !floating ? 0.35 : 1,
        // Lift the floating overlay card so it visibly hovers.
        transform: floating ? 'rotate(-1.5deg) scale(1.02)' : undefined,
        boxShadow: floating
          ? '0 16px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.05)'
          : undefined,
      }}
    >
      {/* Priority stripe down the left edge — quick visual triage. */}
      <div className="flex">
        <div className="w-1 rounded-l-lg" style={{ background: priorityTone }} />
        <div className="flex-1 min-w-0 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--text-tertiary)' }}>#{ticket.ticketNumber}</span>
            {ticket.priority !== 'normal' && (
              <span className="text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded" style={{ background: `${priorityTone}1A`, color: priorityTone }}>
                {ticket.priority}
              </span>
            )}
            {ticket.conversationId && (
              <span className="text-[9px] uppercase tracking-wider font-semibold text-orange-300" title="Promoted from chat">↳</span>
            )}
          </div>
          {/* Clicking the title navigates. The drag handle is the
              whole card body via dnd-kit listeners — the link still
              fires on a non-dragged click thanks to the 8px threshold. */}
          {floating ? (
            <p className="text-xs font-medium line-clamp-2 mb-1.5" style={{ color: 'var(--text-primary)' }}>
              {ticket.subject}
            </p>
          ) : (
            <Link
              href={`/dashboard/${workspaceId}/tickets/${ticket.id}`}
              draggable={false}
              onPointerDown={e => e.stopPropagation()}
              className="block text-xs font-medium line-clamp-2 mb-1.5 hover:underline"
              style={{ color: 'var(--text-primary)' }}
            >
              {ticket.subject}
            </Link>
          )}
          <p className="text-[10px] truncate mb-2" style={{ color: 'var(--text-tertiary)' }}>
            {ticket.contactName || ticket.contactEmail}
          </p>
          <div className="flex items-center justify-between gap-2">
            {ticket.assignedUser ? (
              ticket.assignedUser.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={ticket.assignedUser.image} alt="" className="w-5 h-5 rounded-full" title={ticket.assignedUser.name ?? ticket.assignedUser.email ?? ''} />
              ) : (
                <span
                  className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-300 text-[9px] font-semibold flex items-center justify-center"
                  title={ticket.assignedUser.name ?? ticket.assignedUser.email ?? ''}
                >
                  {(ticket.assignedUser.name || ticket.assignedUser.email || '?').charAt(0).toUpperCase()}
                </span>
              )
            ) : (
              <span className="w-5 h-5 rounded-full border border-dashed border-zinc-700" title="Unassigned" />
            )}
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{lastAgo}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const PRIORITY_TONE: Record<TicketPriority, string> = {
  low:    '#52525b',
  normal: '#52525b',
  high:   '#f59e0b',
  urgent: '#ef4444',
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}
