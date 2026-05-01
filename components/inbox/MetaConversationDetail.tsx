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
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-zinc-700 border-t-orange-500 animate-spin" />
      </div>
    )
  }
  if (notFound || !convo) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <p className="text-sm font-medium text-white mb-1">Conversation not found</p>
        <p className="text-xs text-zinc-500">It may have been deleted, or it belongs to a different workspace.</p>
      </div>
    )
  }

  const channelLabel = convo.channel === 'instagram' ? 'Instagram Direct' : 'Facebook Messenger'
  const senderLabel = convo.senderName || `User ${convo.senderId.slice(-6)}`

  return (
    <div className="flex-1 flex flex-col h-full bg-black overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-zinc-800">
        {convo.senderProfilePicUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={convo.senderProfilePicUrl} alt="" className="w-9 h-9 rounded-full bg-zinc-800 object-cover" />
        ) : (
          <span className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-semibold text-white">
            {senderLabel.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{senderLabel}</p>
          <p className="text-[11px] text-zinc-500 truncate">
            {channelLabel}
            {convo.pageName && <> · {convo.pageName}</>}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-white p-1.5"
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
          <p className="text-center text-xs text-zinc-500 py-8">No messages yet.</p>
        ) : convo.messages.map(m => (
          <Bubble key={m.id} msg={m} channel={convo.channel} />
        ))}
      </div>

      {/* Reply box */}
      <div className="border-t border-zinc-800 p-3">
        {sendError && (
          <p className="mb-2 text-[11px] text-rose-300">{sendError}</p>
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
            placeholder={`Reply on ${channelLabel}…`}
            rows={1}
            className="flex-1 resize-none bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 max-h-32"
          />
          <button
            type="button"
            onClick={send}
            disabled={!reply.trim() || sending}
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-orange-600"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        <p className="mt-1.5 text-[10px] text-zinc-600">
          Replies are subject to Meta&rsquo;s 24-hour messaging window.
        </p>
      </div>
    </div>
  )
}

function Bubble({ msg, channel }: { msg: Message; channel: 'messenger' | 'instagram' }) {
  const isOut = msg.direction === 'out'
  const accent = channel === 'instagram' ? '#E4405F' : '#1877F2'
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
          isOut
            ? 'text-white'
            : 'bg-zinc-900 text-zinc-100 border border-zinc-800'
        }`}
        style={isOut ? { background: accent } : undefined}
      >
        {msg.text || <span className="italic opacity-70">(no text)</span>}
        <div className={`text-[10px] mt-1 ${isOut ? 'text-white/70' : 'text-zinc-500'}`}>
          {formatTime(msg.createdAt)}
          {msg.sentByUserId && isOut && <> · operator</>}
          {!msg.sentByUserId && isOut && <> · agent</>}
        </div>
      </div>
    </div>
  )
}
