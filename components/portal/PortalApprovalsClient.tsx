'use client'

/**
 * Portal approval queue — pending TicketReplyDrafts for the user's
 * brands. Approve sends the email to the customer through the standard
 * ticketing path; Reject returns it to the support team with a note.
 */

import { useCallback, useEffect, useState } from 'react'
import { computeReplyDiff } from '@/lib/tickets/reply-diff'

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
  editedBody: string | null
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
  // Send failures must outlive the card that triggered them: the card
  // unmounts on reload, so we surface the warning at page level instead.
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/portal/approvals')
      const data = await res.json()
      if (Array.isArray(data.pending)) setPending(data.pending)
      if (Array.isArray(data.recentDecided)) setDecided(data.recentDecided)
    } finally { setLoading(false) }
  }, [])

  const handleDecided = useCallback((result?: { emailError?: string; ticketNumber?: number }) => {
    if (result?.emailError) {
      setNotice(`Ticket #${result.ticketNumber}: the reply was approved but the email failed to send — ${result.emailError} The support team has been notified; transient failures retry automatically.`)
    }
    load()
  }, [load])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <p className="text-sm text-zinc-500 mt-8">Loading…</p>
  }

  return (
    <div className="mt-6 space-y-6">
      {notice && (
        <div className="rounded-xl border p-3 flex items-start gap-3" style={{ borderColor: 'var(--accent-red)', background: 'color-mix(in srgb, var(--accent-red) 8%, transparent)' }}>
          <p className="text-xs flex-1" style={{ color: 'var(--accent-red)' }}>{notice}</p>
          <button onClick={() => setNotice(null)} className="text-xs text-zinc-400 hover:text-zinc-200 flex-shrink-0">Dismiss</button>
        </div>
      )}
      {pending.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 p-10 text-center" style={{ background: 'var(--surface)' }}>
          <p className="text-sm text-zinc-400">Nothing waiting for approval. 🎉</p>
          <p className="text-[11px] text-zinc-600 mt-1">When the support team submits a reply for sign-off, it appears here.</p>
        </div>
      ) : (
        pending.map(d => <PendingCard key={d.id} draft={d} onDecided={handleDecided} />)
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
                  {d.status === 'approved' ? (d.editedBody ? 'Approved with changes' : 'Approved') : 'Rejected'} by {d.reviewedByEmail ?? 'someone'}
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

function PendingCard({ draft, onDecided }: { draft: DraftRow; onDecided: (result?: { emailError?: string; ticketNumber?: number }) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The reviewer edits the reply in place; `edited` starts as the drafted text.
  const [edited, setEdited] = useState(draft.body)
  const [showDiff, setShowDiff] = useState(false)

  const diff = computeReplyDiff(draft.body, edited)
  const isEdited = diff.changed

  async function decide(action: 'approve' | 'reject') {
    if (action === 'reject' && !note.trim()) {
      setError('Add a short note so the support team knows what to change.')
      return
    }
    if (action === 'approve') {
      const verb = isEdited ? 'Send this reply (with your edits)' : 'Send this reply'
      if (!confirm(`${verb} to ${draft.ticket.contactEmail} now?`)) return
    }
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(`/api/portal/approvals/${draft.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          note: note.trim() || undefined,
          // Only send the body on approve when it actually changed.
          body: action === 'approve' && isEdited ? edited : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return }
      // The card unmounts on reload; hand a send failure to the parent so the
      // reviewer still sees it afterwards.
      onDecided(data.emailError ? { emailError: data.emailError, ticketNumber: draft.ticket.ticketNumber } : undefined)
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
          <div className="flex items-center gap-2 mb-1.5">
            <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--portal-accent)' }}>
              Proposed reply — edit before sending
            </p>
            {isEdited && (
              <>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}>
                  ● Edited
                </span>
                <button
                  type="button"
                  onClick={() => setShowDiff(v => !v)}
                  className="text-[10px] underline text-zinc-400 hover:text-zinc-200"
                >
                  {showDiff ? 'Hide changes' : 'View changes'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEdited(draft.body); setShowDiff(false) }}
                  className="text-[10px] underline text-zinc-500 hover:text-zinc-300"
                >
                  Revert
                </button>
              </>
            )}
          </div>
          <textarea
            value={edited}
            onChange={e => setEdited(e.target.value)}
            rows={Math.min(16, Math.max(5, edited.split('\n').length + 1))}
            className="w-full rounded-md px-3 py-2 text-sm bg-zinc-900/60 border border-zinc-800 text-zinc-100 whitespace-pre-wrap focus:outline-none focus:border-[var(--portal-accent)] resize-y"
          />
          {isEdited && showDiff && (
            <pre className="mt-2 text-[11px] leading-relaxed rounded-md p-2 overflow-x-auto border border-zinc-800 bg-zinc-950/60 whitespace-pre-wrap">
              {diff.unified.split('\n').map((line, i) => {
                const color = line.startsWith('+ ') ? 'var(--accent-emerald)'
                  : line.startsWith('- ') ? 'var(--accent-red)'
                  : 'var(--text-muted, #a1a1aa)'
                return <div key={i} style={{ color }}>{line || ' '}</div>
              })}
            </pre>
          )}
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
            {busy === 'approve' ? 'Sending…' : isEdited ? 'Approve with changes & send' : 'Approve & send'}
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
