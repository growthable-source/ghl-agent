'use client'

/**
 * Ticket detail — header (status / priority / assignee dropdowns),
 * message thread (inbound / outbound / internal_note), and a
 * compose box with "✨ Suggest reply" that pre-fills via the AI
 * agent.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface MessageRow {
  id: string
  direction: 'inbound' | 'outbound' | 'internal_note'
  body: string
  fromEmail: string | null
  fromName: string | null
  sentByUser: { id: string; name: string | null; email: string | null; image: string | null } | null
  sentAt: string | null
  emailError?: string | null
  emailNextRetryAt?: string | null
  createdAt: string
}

interface TicketDetail {
  id: string
  ticketNumber: number
  subject: string
  summary: string | null
  status: 'open' | 'pending' | 'on_hold' | 'resolved' | 'closed'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  contactEmail: string
  contactName: string | null
  contactPhone: string | null
  assignedUserId: string | null
  assignedUser: { id: string; name: string | null; email: string | null; image: string | null } | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  closedAt: string | null
  reopenedAt: string | null
  createdAt: string
  messages: MessageRow[]
  conversation: { id: string; widgetId: string; widget: { name: string } } | null
}

const STATUSES: Array<{ key: TicketDetail['status']; label: string; tone: string }> = [
  { key: 'open',     label: 'Open',     tone: '#3b82f6' },
  { key: 'pending',  label: 'Pending',  tone: '#f59e0b' },
  { key: 'on_hold',  label: 'On hold',  tone: '#a855f7' },
  { key: 'resolved', label: 'Resolved', tone: '#22c55e' },
  { key: 'closed',   label: 'Closed',   tone: '#71717a' },
]

const PRIORITIES: TicketDetail['priority'][] = ['low', 'normal', 'high', 'urgent']

interface SnippetRow { id: string; title: string; content: string; kind: string }

interface DraftRow {
  id: string
  body: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  reviewNote: string | null
  reviewedByEmail: string | null
  reviewedAt: string | null
  createdAt: string
  submittedByUser: { name: string | null; email: string | null } | null
}

export default function TicketDetailPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const ticketId = params.ticketId as string

  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<Array<{ user: { id: string; name: string | null; email: string | null } }>>([])

  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [internalNote, setInternalNote] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [suggestInfo, setSuggestInfo] = useState<string | null>(null)
  const [suggestWarning, setSuggestWarning] = useState<string | null>(null)
  const [snippets, setSnippets] = useState<SnippetRow[]>([])
  const [showSnippets, setShowSnippets] = useState(false)
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [submittingApproval, setSubmittingApproval] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, mRes, sRes, dRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}`),
        fetch(`/api/workspaces/${workspaceId}/members`),
        fetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}/snippets`),
        fetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}/submit-approval`),
      ])
      const t = await tRes.json()
      const m = await mRes.json()
      const s = await sRes.json().catch(() => ({}))
      const d = await dRes.json().catch(() => ({}))
      if (t.ticket) setTicket(t.ticket)
      if (Array.isArray(m.members)) setMembers(m.members)
      if (Array.isArray(s.snippets)) setSnippets(s.snippets)
      if (Array.isArray(d.drafts)) setDrafts(d.drafts)
    } finally { setLoading(false) }
  }, [workspaceId, ticketId])

  useEffect(() => { load() }, [load])

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) load()
    else alert((await res.json()).error || 'Update failed')
  }

  async function send() {
    if (!reply.trim()) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: reply,
          direction: internalNote ? 'internal_note' : 'outbound',
          sendEmail: !internalNote,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setSendError(data.error || 'Send failed.'); return }
      if (data.emailError) setSendError(`Saved as draft, but email failed: ${data.emailError}`)
      setReply('')
      setInternalNote(false)
      load()
    } finally { setSending(false) }
  }

  async function suggest() {
    setSuggesting(true)
    setSuggestInfo(null)
    setSuggestWarning(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}/suggest-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) { setSuggestInfo(data.error || 'Suggestion failed.'); return }
      setReply(data.draft)
      const used = data.contextUsed as Record<string, number> | undefined
      const parts = [
        data.knowledgeUsed ? `${data.knowledgeUsed} knowledge passages` : null,
        used?.requesterTickets ? `${used.requesterTickets} past tickets from this customer` : null,
        used?.brandTickets ? `${used.brandTickets} brand tickets` : null,
        used?.conversations ? `${used.conversations} chat summaries` : null,
        used?.snippets ? `${used.snippets} snippets available` : null,
      ].filter(Boolean)
      setSuggestInfo(`Drafted by ${data.agentName}${parts.length ? ` · used ${parts.join(', ')}` : ''}`)
      if (Array.isArray(data.keywordWarnings) && data.keywordWarnings.length > 0) {
        setSuggestWarning(`Contains brand-forbidden ${data.keywordWarnings.length === 1 ? 'phrase' : 'phrases'}: ${data.keywordWarnings.map((k: string) => `"${k}"`).join(', ')} — edit before sending.`)
      }
    } finally { setSuggesting(false) }
  }

  const pendingDraft = drafts.find(d => d.status === 'pending') ?? null
  const lastRejected = !pendingDraft ? drafts.find(d => d.status === 'rejected') ?? null : null

  async function submitForApproval() {
    if (!reply.trim()) return
    setSubmittingApproval(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}/submit-approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: reply }),
      })
      const data = await res.json()
      if (!res.ok) { setSendError(data.error || 'Submit failed.'); return }
      setReply('')
      load()
    } finally { setSubmittingApproval(false) }
  }

  async function withdrawDraft(draftId: string) {
    const res = await fetch(`/api/workspaces/${workspaceId}/tickets/${ticketId}/submit-approval?draftId=${draftId}`, { method: 'DELETE' })
    if (res.ok) load()
    else setSendError((await res.json()).error || 'Withdraw failed.')
  }

  function insertSnippet(s: SnippetRow) {
    setReply(r => {
      if (!r.trim()) return s.content
      const sep = r.endsWith('\n') ? '\n' : '\n\n'
      return `${r}${sep}${s.content}`
    })
    setShowSnippets(false)
  }

  if (loading || !ticket) {
    return <div className="p-8"><p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p></div>
  }

  const statusTone = STATUSES.find(s => s.key === ticket.status)!.tone

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-8">
        <Link href={`/dashboard/${workspaceId}/tickets`} className="text-xs hover:underline" style={{ color: 'var(--text-tertiary)' }}>
          ← All tickets
        </Link>

        <div className="mt-3 mb-6 flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
                #{ticket.ticketNumber}
              </span>
              {ticket.conversation && (
                <Link
                  href={`/dashboard/${workspaceId}/inbox?conversation=${ticket.conversation.id}`}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 hover:underline"
                >
                  ↳ from chat on {ticket.conversation.widget.name}
                </Link>
              )}
            </div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{ticket.subject}</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {ticket.contactName ? `${ticket.contactName} · ` : ''}{ticket.contactEmail}
              {ticket.contactPhone && ` · ${ticket.contactPhone}`}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={ticket.status}
              onChange={e => patch({ status: e.target.value })}
              className="text-xs font-medium rounded-lg px-2 py-1.5"
              style={{ background: `${statusTone}1A`, color: statusTone, border: `1px solid ${statusTone}` }}
            >
              {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select
              value={ticket.priority}
              onChange={e => patch({ priority: e.target.value })}
              className="text-xs font-medium rounded-lg px-2 py-1.5"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            >
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select
              value={ticket.assignedUserId ?? ''}
              onChange={e => patch({ assignedUserId: e.target.value || null })}
              className="text-xs rounded-lg px-2 py-1.5 max-w-[160px]"
              style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
            >
              <option value="">Unassigned</option>
              {members.map(m => (
                <option key={m.user.id} value={m.user.id}>{m.user.name || m.user.email}</option>
              ))}
            </select>
          </div>
        </div>

        {ticket.summary && (
          <div className="rounded-xl border p-4 mb-6" style={{ borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--accent-emerald)' }}>
              Chat summary
            </p>
            <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {ticket.summary}
            </p>
          </div>
        )}

        <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {ticket.messages.map(m => (
            <MessageRowView key={m.id} message={m} contactName={ticket.contactName} contactEmail={ticket.contactEmail} />
          ))}
        </div>

        {/* Approval status banners */}
        {pendingDraft && (
          <div className="rounded-xl border p-4 mb-6" style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--accent-amber)' }}>
                  Awaiting portal approval
                </p>
                <p className="text-xs whitespace-pre-wrap leading-relaxed line-clamp-4" style={{ color: 'var(--text-secondary)' }}>
                  {pendingDraft.body}
                </p>
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  Submitted {new Date(pendingDraft.createdAt).toLocaleString()} — the customer receives nothing until a portal user approves it.
                </p>
              </div>
              <button
                onClick={() => withdrawDraft(pendingDraft.id)}
                className="text-[11px] shrink-0 hover:underline"
                style={{ color: 'var(--accent-amber)' }}
              >
                Withdraw
              </button>
            </div>
          </div>
        )}
        {lastRejected && (
          <div className="rounded-xl border p-4 mb-6" style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--accent-red)' }}>
              Reply rejected{lastRejected.reviewedByEmail ? ` by ${lastRejected.reviewedByEmail}` : ''}
            </p>
            {lastRejected.reviewNote && (
              <p className="text-xs leading-relaxed mb-1.5" style={{ color: 'var(--text-secondary)' }}>“{lastRejected.reviewNote}”</p>
            )}
            <button
              onClick={() => setReply(lastRejected.body)}
              className="text-[11px] hover:underline"
              style={{ color: 'var(--accent-red)' }}
            >
              Load rejected draft into composer to revise
            </button>
          </div>
        )}

        {/* Composer */}
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
            <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {internalNote ? 'Internal note' : `Reply to ${ticket.contactEmail}`}
            </p>
            <div className="flex items-center gap-2">
              {snippets.length > 0 && (
                <button
                  onClick={() => setShowSnippets(v => !v)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border disabled:opacity-50"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', background: 'var(--surface-secondary)' }}
                >
                  📎 Snippets ({snippets.length})
                </button>
              )}
              <button
                onClick={suggest}
                disabled={suggesting}
                className="text-xs font-semibold px-3 py-1.5 rounded-lg border disabled:opacity-50"
                style={{ borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }}
              >
                {suggesting ? 'Thinking…' : '✨ Suggest reply'}
              </button>
              <label className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                <input type="checkbox" checked={internalNote} onChange={e => setInternalNote(e.target.checked)} />
                Internal note
              </label>
            </div>
          </div>
          {showSnippets && (
            <div className="rounded-lg border mb-2 max-h-48 overflow-y-auto" style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}>
              <p className="text-[10px] uppercase tracking-wider font-semibold px-3 pt-2 pb-1" style={{ color: 'var(--text-tertiary)' }}>
                Brand snippets — click to insert
              </p>
              {snippets.map(s => (
                <button
                  key={s.id}
                  onClick={() => insertSnippet(s)}
                  className="block w-full text-left px-3 py-2 border-t hover:opacity-80"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <span className="text-xs font-medium block" style={{ color: 'var(--text-primary)' }}>{s.title}</span>
                  <span className="text-[11px] block truncate" style={{ color: 'var(--text-tertiary)' }}>{s.content}</span>
                </button>
              ))}
            </div>
          )}
          {suggestInfo && (
            <p className="text-[11px] mb-2" style={{ color: 'var(--accent-emerald)' }}>{suggestInfo}</p>
          )}
          {suggestWarning && (
            <p className="text-[11px] mb-2 font-medium" style={{ color: 'var(--accent-amber)' }}>⚠ {suggestWarning}</p>
          )}
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            placeholder={internalNote ? 'Note for the team — not sent to the customer.' : 'Type your reply, or click Suggest reply to have the AI draft one.'}
            rows={8}
            className="w-full rounded-lg px-3 py-2 text-sm mb-3"
            style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
          />
          {sendError && (
            <p className="text-[11px] mb-2" style={{ color: 'var(--accent-red)' }}>{sendError}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            {!internalNote && (
              <button
                onClick={submitForApproval}
                disabled={submittingApproval || !reply.trim() || !!pendingDraft}
                title={pendingDraft ? 'A draft is already awaiting approval — withdraw it first.' : 'Send to portal users for sign-off before it reaches the customer.'}
                className="text-sm font-semibold px-4 py-2 rounded-lg border disabled:opacity-50"
                style={{ borderColor: 'var(--accent-amber)', color: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}
              >
                {submittingApproval ? 'Submitting…' : 'Submit for approval'}
              </button>
            )}
            <button
              onClick={send}
              disabled={sending || !reply.trim()}
              className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
            >
              {sending ? 'Sending…' : internalNote ? 'Save note' : 'Send email'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageRowView({ message, contactName, contactEmail }: { message: MessageRow; contactName: string | null; contactEmail: string }) {
  const isInbound = message.direction === 'inbound'
  const isNote = message.direction === 'internal_note'
  const who = isInbound ? (contactName || contactEmail)
    : isNote ? `Note · ${message.sentByUser?.name || message.sentByUser?.email || 'Team'}`
    : `${message.sentByUser?.name || message.sentByUser?.email || 'Team'}`
  return (
    <div className="p-4 border-t first:border-t-0" style={{
      borderColor: 'var(--border)',
      background: isNote ? 'var(--accent-amber-bg)' : isInbound ? 'var(--surface-secondary)' : undefined,
    }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded" style={{
          background: isInbound ? 'rgba(59,130,246,0.15)' : isNote ? 'var(--accent-amber-bg)' : 'rgba(34,197,94,0.15)',
          color: isInbound ? '#3b82f6' : isNote ? 'var(--accent-amber)' : '#22c55e',
        }}>
          {isInbound ? 'Inbound' : isNote ? 'Internal' : 'Outbound'}
        </span>
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{who}</span>
        {message.emailError && !message.sentAt && (
          <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded" style={{
            background: 'var(--accent-red-bg)', color: '#ef4444',
          }}>
            {message.emailNextRetryAt ? 'Email retrying' : 'Email failed'}
          </span>
        )}
        <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
          {new Date(message.sentAt || message.createdAt).toLocaleString()}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{message.body}</p>
      {message.emailError && !message.sentAt && (
        <p className="mt-1.5 text-xs" style={{ color: '#ef4444' }}>
          {message.emailNextRetryAt
            ? `Delivery failed — will retry automatically. (${message.emailError})`
            : `This reply was NOT delivered by email: ${message.emailError}`}
        </p>
      )}
    </div>
  )
}
