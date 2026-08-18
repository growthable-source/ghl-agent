'use client'

/**
 * Portal ticket workspace — the brand-side detail view. Shows the full
 * email thread (internal notes never reach the portal API), lets the
 * portal user change status, reply directly to the customer, and sign
 * off on any pending reply drafts the workspace team submitted —
 * approve/reject go through the EXISTING /api/portal/approvals/[id]
 * endpoint, so this page and the approvals queue stay one workflow.
 *
 * The assignee is intentionally read-only: portal users and workspace
 * staff are different auth realms; who works the ticket is the
 * workspace's call.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface Message {
  id: string
  direction: 'inbound' | 'outbound'
  body: string
  fromEmail: string | null
  fromName: string | null
  sentAt: string | null
  emailError: string | null
  createdAt: string
  sentByUser: { name: string | null } | null
}

interface PendingDraft {
  id: string
  body: string
  createdAt: string
  submittedByUser: { name: string | null } | null
}

interface TicketDetail {
  id: string
  ticketNumber: number
  subject: string
  status: string
  priority: string
  brand: { id: string; name: string; primaryColor: string | null; logoUrl: string | null } | null
  contactEmail: string
  contactName: string | null
  summary: string | null
  assignedUser: { name: string | null } | null
  createdAt: string
  messages: Message[]
  replyDrafts: PendingDraft[]
}

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
]

export default function PortalTicketDetailClient({ ticketId }: { ticketId: string }) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [statusSaving, setStatusSaving] = useState(false)
  const [decidingId, setDecidingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/tickets/${ticketId}`)
      if (res.ok) {
        const data = await res.json()
        setTicket(data.ticket)
      }
    } finally { setLoading(false) }
  }, [ticketId])

  useEffect(() => { load() }, [load])

  async function changeStatus(status: string) {
    if (!ticket) return
    setStatusSaving(true)
    try {
      const res = await fetch(`/api/portal/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) setTicket({ ...ticket, status })
    } finally { setStatusSaving(false) }
  }

  async function send() {
    const body = reply.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/portal/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setSendError(data.error || 'Failed to send.'); return }
      if (data.emailError) setSendError(`Recorded, but the email failed to send: ${data.emailError}`)
      setReply('')
      await load()
    } finally { setSending(false) }
  }

  async function decideDraft(draftId: string, action: 'approve' | 'reject') {
    setDecidingId(draftId)
    try {
      await fetch(`/api/portal/approvals/${draftId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      await load()
    } finally { setDecidingId(null) }
  }

  if (loading) {
    return <div className="p-8 max-w-4xl mx-auto"><p className="text-sm text-zinc-500">Loading…</p></div>
  }
  if (!ticket) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <p className="text-sm text-zinc-400">Ticket not found.</p>
        <Link href="/portal/tickets" className="text-xs mt-2 inline-block" style={{ color: 'var(--portal-accent)' }}>← Back to tickets</Link>
      </div>
    )
  }

  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto">
      <Link href="/portal/tickets" className="text-xs text-zinc-500 hover:text-zinc-300">← All tickets</Link>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="mt-3 flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-zinc-500">#{ticket.ticketNumber}</span>
            {ticket.brand && (
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                <span className="w-3 h-3 rounded-sm" style={{ background: ticket.brand.primaryColor || 'var(--portal-accent)' }} />
                {ticket.brand.name}
              </span>
            )}
          </div>
          <h1 className="text-xl font-semibold text-white mt-1">{ticket.subject}</h1>
          <p className="text-xs text-zinc-500 mt-1">
            {ticket.contactName ? `${ticket.contactName} · ` : ''}{ticket.contactEmail}
            {ticket.assignedUser?.name ? ` · Handled by ${ticket.assignedUser.name}` : ''}
          </p>
        </div>
        <div className="shrink-0">
          <select
            value={ticket.status}
            disabled={statusSaving}
            onChange={e => changeStatus(e.target.value)}
            className="text-xs rounded-lg px-3 py-2 bg-zinc-900 text-zinc-200 border border-zinc-700"
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {ticket.summary && (
        <div className="mt-4 rounded-xl border border-zinc-800 p-3" style={{ background: 'var(--surface)' }}>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">Summary</p>
          <p className="text-xs text-zinc-300 whitespace-pre-wrap">{ticket.summary}</p>
        </div>
      )}

      {/* ── Thread ─────────────────────────────────────────────────── */}
      <div className="mt-5 space-y-3">
        {ticket.messages.length === 0 && (
          <p className="text-xs text-zinc-500">No messages yet.</p>
        )}
        {ticket.messages.map(m => (
          <div key={m.id} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
            <div
              className="max-w-[85%] rounded-xl px-3.5 py-2.5 border"
              style={m.direction === 'outbound'
                ? { background: 'var(--surface-secondary)', borderColor: 'var(--portal-accent)' }
                : { background: 'var(--surface)', borderColor: 'var(--border, #27272a)' }}
            >
              <p className="text-[10px] text-zinc-500 mb-1">
                {m.direction === 'outbound'
                  ? (m.sentByUser?.name || m.fromName || 'Support')
                  : (m.fromName || m.fromEmail || ticket.contactEmail)}
                {' · '}{new Date(m.createdAt).toLocaleString()}
              </p>
              <p className="text-sm text-zinc-100 whitespace-pre-wrap break-words">{m.body}</p>
              {m.emailError && !m.sentAt && (
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--accent-red)' }}>
                  ⚠ Email not delivered yet: {m.emailError}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Pending drafts from the support team ───────────────────── */}
      {ticket.replyDrafts.length > 0 && (
        <div className="mt-6 rounded-xl border border-amber-500/30 overflow-hidden" style={{ background: 'var(--surface)' }}>
          <div className="px-4 py-2.5 border-b border-amber-500/30 bg-amber-500/5">
            <p className="text-xs font-semibold text-amber-300">
              {ticket.replyDrafts.length === 1 ? 'A reply is' : `${ticket.replyDrafts.length} replies are`} waiting for your sign-off
            </p>
          </div>
          <div className="divide-y divide-zinc-800">
            {ticket.replyDrafts.map(d => (
              <div key={d.id} className="p-4">
                <p className="text-[10px] text-zinc-500 mb-1.5">
                  Drafted by {d.submittedByUser?.name || 'the support team'} · {new Date(d.createdAt).toLocaleString()}
                </p>
                <p className="text-sm text-zinc-200 whitespace-pre-wrap">{d.body}</p>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => decideDraft(d.id, 'approve')}
                    disabled={decidingId === d.id}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style={{ background: 'var(--accent-emerald)', color: '#000' }}
                  >
                    {decidingId === d.id ? 'Working…' : 'Approve & send'}
                  </button>
                  <button
                    onClick={() => decideDraft(d.id, 'reject')}
                    disabled={decidingId === d.id}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Composer ───────────────────────────────────────────────── */}
      <div className="mt-6 rounded-xl border border-zinc-800 p-4" style={{ background: 'var(--surface)' }}>
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
          Reply to {ticket.contactName || ticket.contactEmail}
        </p>
        <textarea
          value={reply}
          onChange={e => setReply(e.target.value)}
          placeholder="Write your reply — it's emailed straight to the customer."
          rows={4}
          className="w-full rounded-lg px-3 py-2 text-sm bg-zinc-900 text-zinc-100 border border-zinc-700 focus:outline-none resize-y"
        />
        {sendError && <p className="text-[11px] mt-2" style={{ color: 'var(--accent-red)' }}>{sendError}</p>}
        <div className="flex justify-end mt-2">
          <button
            onClick={send}
            disabled={sending || !reply.trim()}
            className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: 'var(--portal-accent)', color: '#000' }}
          >
            {sending ? 'Sending…' : 'Send reply'}
          </button>
        </div>
      </div>
    </div>
  )
}
