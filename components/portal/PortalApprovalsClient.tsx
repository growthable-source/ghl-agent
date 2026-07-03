'use client'

/**
 * Portal approval queue — pending TicketReplyDrafts for the user's
 * brands. Approve sends the email to the customer through the standard
 * ticketing path; Reject returns it to the support team with a note.
 */

import { useCallback, useEffect, useState } from 'react'

interface DraftTicket {
  id: string
  ticketNumber: number
  subject: string
  status: string
  contactEmail: string
  contactName: string | null
  brandName: string | null
  lastInbound: string | null
}

interface DraftRow {
  id: string
  body: string
  status: string
  reviewNote: string | null
  reviewedByEmail: string | null
  reviewedAt: string | null
  createdAt: string
  submittedBy: string
  ticket: DraftTicket
}

export default function PortalApprovalsClient() {
  const [pending, setPending] = useState<DraftRow[]>([])
  const [decided, setDecided] = useState<DraftRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/approvals')
      const data = await res.json()
      if (Array.isArray(data.pending)) setPending(data.pending)
      if (Array.isArray(data.recentDecided)) setDecided(data.recentDecided)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <p className="text-sm text-zinc-500 mt-8">Loading…</p>
  }

  return (
    <div className="mt-6 space-y-6">
      {pending.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 p-10 text-center" style={{ background: 'var(--surface)' }}>
          <p className="text-sm text-zinc-400">Nothing waiting for approval. 🎉</p>
          <p className="text-[11px] text-zinc-600 mt-1">When the support team submits a reply for sign-off, it appears here.</p>
        </div>
      ) : (
        pending.map(d => <PendingCard key={d.id} draft={d} onDecided={load} />)
      )}

      {decided.length > 0 && (
        <section>
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Recently decided</p>
          <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden" style={{ background: 'var(--surface)' }}>
            {decided.map(d => (
              <div key={d.id} className="px-4 py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] text-zinc-500">#{d.ticket.ticketNumber}</span>
                  <span className="text-xs text-zinc-200 flex-1 min-w-0 truncate">{d.ticket.subject}</span>
                  <DecisionBadge status={d.status} />
                </div>
                <p className="text-[10px] text-zinc-500 mt-1">
                  {d.status === 'approved' ? 'Approved' : 'Rejected'} by {d.reviewedByEmail ?? 'someone'}
                  {d.reviewedAt ? ` · ${new Date(d.reviewedAt).toLocaleString()}` : ''}
                  {d.reviewNote ? ` — “${d.reviewNote}”` : ''}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function PendingCard({ draft, onDecided }: { draft: DraftRow; onDecided: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(action: 'approve' | 'reject') {
    if (action === 'reject' && !note.trim()) {
      setError('Add a short note so the support team knows what to change.')
      return
    }
    if (action === 'approve' && !confirm(`Send this reply to ${draft.ticket.contactEmail} now?`)) return
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(`/api/portal/approvals/${draft.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return }
      if (data.emailError) setError(`Approved, but the email failed to send: ${data.emailError}`)
      onDecided()
    } finally { setBusy(null) }
  }

  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden" style={{ background: 'var(--surface)' }}>
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[10px] text-zinc-500">#{draft.ticket.ticketNumber}</span>
        <p className="text-sm font-medium text-zinc-100 flex-1 min-w-0 truncate">{draft.ticket.subject}</p>
        {draft.ticket.brandName && (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-400">{draft.ticket.brandName}</span>
        )}
      </div>

      <div className="p-4 space-y-3">
        <p className="text-[11px] text-zinc-500">
          To <span className="text-zinc-300">{draft.ticket.contactName || draft.ticket.contactEmail}</span>
          {draft.ticket.contactName ? ` (${draft.ticket.contactEmail})` : ''} · drafted by {draft.submittedBy} · {new Date(draft.createdAt).toLocaleString()}
        </p>

        {draft.ticket.lastInbound && (
          <div className="rounded-lg border border-zinc-800 p-3" style={{ background: 'var(--surface-secondary)' }}>
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">Customer asked</p>
            <p className="text-xs text-zinc-300 whitespace-pre-wrap line-clamp-6">{draft.ticket.lastInbound}</p>
          </div>
        )}

        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--portal-accent)', background: 'color-mix(in srgb, var(--portal-accent) 6%, transparent)' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--portal-accent)' }}>Proposed reply</p>
          <p className="text-sm text-zinc-100 whitespace-pre-wrap">{draft.body}</p>
        </div>

        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Optional note (required when rejecting) — e.g. tone it down, wrong link…"
          className="w-full rounded-lg px-3 py-2 text-sm bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[var(--portal-accent)]"
        />
        {error && <p className="text-[11px]" style={{ color: 'var(--accent-red)' }}>{error}</p>}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => decide('reject')}
            disabled={!!busy}
            className="text-xs font-semibold px-4 py-2 rounded-lg border disabled:opacity-50"
            style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
          >
            {busy === 'reject' ? 'Rejecting…' : 'Reject'}
          </button>
          <button
            onClick={() => decide('approve')}
            disabled={!!busy}
            className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: 'var(--accent-emerald)', color: '#08130c' }}
          >
            {busy === 'approve' ? 'Sending…' : 'Approve & send'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DecisionBadge({ status }: { status: string }) {
  const approved = status === 'approved'
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize"
      style={approved
        ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
        : { background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
    >
      {status}
    </span>
  )
}
