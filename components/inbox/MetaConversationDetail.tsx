'use client'

/**
 * Conversation detail panel for Messenger / Instagram threads.
 *
 * Mirrors the role of widget ConversationDetail but for Meta channels.
 * Kept deliberately simpler — Meta's Send API is request/response (no
 * streaming), CSAT/typing indicators don't apply, and the visitor
 * timeline / CRM context blocks are widget-only concepts. Polls every
 * 6 seconds for new messages instead of holding an SSE connection.
 */

import { useEffect, useState, useCallback, useRef } from 'react'

interface Message {
  id: string
  direction: 'in' | 'out'
  text: string | null
  sentByUserId: string | null
  createdAt: string
}

interface Convo {
  id: string
  channel: 'messenger' | 'instagram'
  pageId: string
  pageName: string | null
  senderId: string
  senderName: string | null
  senderProfilePicUrl: string | null
  status: string
  lastMessageAt: string
  createdAt: string
  assignedUser: { id: string; name: string | null; email: string | null; image: string | null } | null
  messages: Message[]
}

interface Props {
  workspaceId: string
  conversationId: string  // bare cuid, NOT prefixed
  onClose?: () => void
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function MetaConversationDetail({ workspaceId, conversationId, onClose }: Props) {
  const [convo, setConvo] = useState<Convo | null>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchConvo = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/meta-conversations/${conversationId}/messages`)
    if (res.status === 404) { setNotFound(true); setLoading(false); return }
    if (!res.ok) { setLoading(false); return }
    const data = await res.json()
    if (data.conversation) setConvo(data.conversation)
    setLoading(false)
  }, [workspaceId, conversationId])

  useEffect(() => { fetchConvo() }, [fetchConvo])

  // Poll for new messages every 6s. Lighter than SSE; Meta's webhook
  // → DB write is the source of truth so a slight delay just means a
  // late-by-one-tick render. If this becomes a bottleneck we can swap
  // in SSE backed by Postgres LISTEN/NOTIFY.
  useEffect(() => {
    const i = setInterval(fetchConvo, 6000)
    return () => clearInterval(i)
  }, [fetchConvo])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [convo?.messages.length])

  async function send() {
    if (!reply.trim() || sending) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/meta-conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reply.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSendError(data?.detail || data?.error || 'Send failed')
        return
      }
      setReply('')
      // Re-fetch immediately so the operator sees their reply land
      // without waiting for the 6-second poll.
      fetchConvo()
    } finally { setSending(false) }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--background)' }}>
        <div
          className="w-8 h-8 rounded-full border-2 animate-spin"
          style={{ borderColor: 'var(--border-secondary)', borderTopColor: 'var(--accent-primary)' }}
        />
      </div>
    )
  }
  if (notFound || !convo) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8" style={{ background: 'var(--background)' }}>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Conversation not found</p>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>It may have been deleted, or it belongs to a different workspace.</p>
      </div>
    )
  }

  const channelLabel = convo.channel === 'instagram' ? 'Instagram Direct' : 'Facebook Messenger'
  const senderLabel = convo.senderName || `User ${convo.senderId.slice(-6)}`

  // The most-recent message determines whether we offer to "Generate
  // an AI draft" — surfaces as a Suggested Draft card above the
  // composer when the visitor has spoken last and the operator hasn't
  // typed anything yet. Matches the mockup pattern.
  const lastMsg = convo.messages[convo.messages.length - 1]
  const visitorWaitingForReply = lastMsg?.direction === 'in' && !reply.trim()

  return (
    <div className="flex-1 flex h-full overflow-hidden" style={{ background: 'var(--background)' }}>
      {/* ─── Main chat column ─── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          {convo.senderProfilePicUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={convo.senderProfilePicUrl}
              alt=""
              className="w-9 h-9 rounded-full object-cover"
              style={{ background: 'var(--surface-tertiary)' }}
            />
          ) : (
            <span
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold"
              style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}
            >
              {senderLabel.charAt(0).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{senderLabel}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded"
                style={
                  convo.channel === 'instagram'
                    ? { background: 'rgba(228, 64, 95, 0.12)', color: '#E4405F' }
                    : { background: 'rgba(24, 119, 242, 0.12)', color: '#1877F2' }
                }
              >
                {convo.channel === 'instagram' ? 'Instagram' : 'Messenger'}
              </span>
              {convo.pageName && (
                <span className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                  · {convo.pageName}
                </span>
              )}
            </div>
          </div>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
            style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
            title="Your agent is handling this thread automatically. Reply below to take over."
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-emerald)' }} />
            Autopilot
          </span>
          <button
            type="button"
            className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            title="Mark this conversation resolved"
          >
            Mark resolved
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              title="Close panel"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Message thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {convo.messages.length === 0 ? (
            <p className="text-center text-xs py-8" style={{ color: 'var(--text-tertiary)' }}>No messages yet.</p>
          ) : convo.messages.map(m => (
            <Bubble key={m.id} msg={m} channel={convo.channel} />
          ))}
        </div>

        {/* Reply box */}
        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          {/* AI Suggested Draft card — shown when visitor has spoken
              last and operator hasn't started typing. Plumbing for an
              actual auto-draft endpoint is TODO; the UI surface is in
              place so the agent can drop a draft into the composer. */}
          {visitorWaitingForReply && (
            <div
              className="mb-2 rounded-lg border p-3"
              style={{ background: 'var(--accent-primary-bg)', borderColor: 'var(--accent-primary)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--accent-primary)' }}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2l1.5 5L19 8l-4.5 3.5L16 17l-4-2.5L8 17l1.5-5.5L5 8l5.5-1z" />
                  </svg>
                  AI Suggested Draft
                </span>
                <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  Autopilot:
                  <span className="font-semibold" style={{ color: 'var(--accent-emerald)' }}>ON</span>
                </span>
              </div>
              <p className="text-xs italic mb-2" style={{ color: 'var(--text-secondary)' }}>
                Autopilot is on — your agent replies automatically. If it hasn&apos;t replied, type below to take over and write your own.
              </p>
            </div>
          )}

          {sendError && (
            <p className="mb-2 text-[11px]" style={{ color: 'var(--accent-red)' }}>{sendError}</p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder={`Type a message…`}
              rows={1}
              className="flex-1 resize-none rounded-lg px-3 py-2 text-sm focus:outline-none max-h-32"
              style={{
                background: 'var(--input-bg)',
                color: 'var(--input-text)',
                border: '1px solid var(--input-border)',
              }}
            />
            <button
              type="button"
              onClick={send}
              disabled={!reply.trim() || sending}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={
                !reply.trim() || sending
                  ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }
                  : { background: 'var(--accent-primary)', color: '#fff' }
              }
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          <p className="mt-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Replies are subject to Meta&rsquo;s 24-hour messaging window.
          </p>
        </div>
      </div>

      {/* ─── About contact rail (right side) ─── */}
      <aside
        className="hidden lg:flex w-72 shrink-0 flex-col border-l overflow-y-auto"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--text-tertiary)' }}>
            About {senderLabel.split(' ')[0]}
          </p>
        </div>
        {/* Contact card */}
        <div className="p-4 border-b text-center" style={{ borderColor: 'var(--border)' }}>
          {convo.senderProfilePicUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={convo.senderProfilePicUrl}
              alt=""
              className="w-16 h-16 rounded-full mx-auto mb-2 object-cover"
              style={{ background: 'var(--surface-tertiary)' }}
            />
          ) : (
            <span
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-semibold mx-auto mb-2"
              style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}
            >
              {senderLabel.charAt(0).toUpperCase()}
            </span>
          )}
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{senderLabel}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
            via {channelLabel}
          </p>
          {convo.assignedUser && (
            <span
              className="inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full mt-2"
              style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
            >
              Assigned to {convo.assignedUser.name || convo.assignedUser.email || 'someone'}
            </span>
          )}
        </div>
        {/* Recent activity */}
        <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Recent activity
          </p>
          <div className="space-y-2 text-xs">
            <ActivityRow label="First contacted" value={relTime(convo.createdAt)} />
            <ActivityRow label="Last message" value={relTime(convo.lastMessageAt)} />
            <ActivityRow label="Total messages" value={`${convo.messages.length}`} />
            <ActivityRow label="Status" value={convo.status === 'active' ? 'Live' : convo.status} />
          </div>
        </div>
        {/* Notes placeholder */}
        <div className="p-4 flex-1">
          <p className="text-[10px] font-semibold tracking-wider uppercase mb-2" style={{ color: 'var(--text-tertiary)' }}>
            Notes
          </p>
          <p className="text-xs italic" style={{ color: 'var(--text-tertiary)' }}>
            No notes yet. Click to add a private note about {senderLabel.split(' ')[0]}.
          </p>
        </div>
      </aside>
    </div>
  )
}

function ActivityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

function Bubble({ msg, channel }: { msg: Message; channel: 'messenger' | 'instagram' }) {
  const isOut = msg.direction === 'out'
  const accent = channel === 'instagram' ? '#E4405F' : '#1877F2'
  // AI-vs-operator signal — match the mockup's "AI" pill on outbound
  // bubbles when no operator userId is recorded.
  const isAI = isOut && !msg.sentByUserId
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[80%] rounded-2xl px-3.5 py-2 text-sm"
        style={
          isOut
            ? { background: accent, color: '#fff' }
            : { background: 'var(--surface-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }
        }
      >
        {isAI && (
          <span
            className="inline-flex items-center text-[9px] font-bold tracking-wider px-1 py-px rounded mr-1.5 align-middle"
            style={{ background: 'rgba(255,255,255,0.25)', color: '#fff' }}
          >
            AI
          </span>
        )}
        {msg.text || <span className="italic opacity-70">(no text)</span>}
        <div className="text-[10px] mt-1" style={isOut ? { color: 'rgba(255,255,255,0.7)' } : { color: 'var(--text-tertiary)' }}>
          {formatTime(msg.createdAt)}
          {msg.sentByUserId && isOut && <> · you</>}
          {!msg.sentByUserId && isOut && <> · agent</>}
        </div>
      </div>
    </div>
  )
}
