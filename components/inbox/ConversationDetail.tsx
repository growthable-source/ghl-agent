'use client'

/**
 * Conversation detail panel — the right side of the split-pane inbox,
 * also rendered standalone at /inbox/[conversationId] for deep-links
 * (notification clicks, shared URLs).
 *
 * Pass `onClose` from the embedded inbox view to wire the ✕ button to
 * close-the-panel. The standalone page omits it; the back-link in the
 * header navigates instead.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'

interface Message {
  id: string
  role: string
  content: string
  kind: string
  createdAt: string
  fromHuman?: boolean
  quickReplies?: string[]
}

interface Convo {
  id: string
  status: string
  lastMessageAt: string
  createdAt: string
  csatRating?: number | null
  csatComment?: string | null
  csatSubmittedAt?: string | null
  visitorConversationCount?: number
  csatHistory?: Array<{ rating: number; submittedAt: string | null }>
  widget: { id: string; name: string; primaryColor: string }
  visitor: { id: string; name: string | null; email: string | null; phone?: string | null; firstSeenAt: string; lastSeenAt?: string }
  messages: Message[]
  assignedUserId?: string | null
  assignedUser?: { id: string; name: string | null; email: string | null; image?: string | null } | null
  assignedAt?: string | null
  assignmentReason?: string | null
}

interface Member {
  id: string
  role: string
  isAvailable?: boolean
  user: { id: string; name: string | null; email: string | null; image: string | null }
}

const EMOJI_GRID = ['👍', '🙏', '😀', '😅', '🎉', '💯', '🔥', '✅', '❌', '👀', '❤️', '🤔', '👋', '✨', '⏰', '📅']

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

interface ConversationDetailProps {
  workspaceId: string
  conversationId: string
  /** When provided, an ✕ button appears in the header that calls this.
   *  Embedded usage (split-pane inbox) wires this to clear the
   *  selected-conversation URL param. Standalone page omits it. */
  onClose?: () => void
}

export default function ConversationDetail({ workspaceId, conversationId, onClose }: ConversationDetailProps) {

  const [convo, setConvo] = useState<Convo | null>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [visitorTyping, setVisitorTyping] = useState(false)
  const [agentTyping, setAgentTyping] = useState<{ active: boolean; fromHuman: boolean }>({ active: false, fromHuman: false })
  const [disconnected, setDisconnected] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [meId, setMeId] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingPingTimer = useRef<any>(null)
  const lastTypingPing = useRef(0)

  const fetchConvo = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/messages`)
    const data = await res.json()
    if (data.conversation) setConvo(data.conversation)
    setLoading(false)
  }, [workspaceId, conversationId])

  useEffect(() => { fetchConvo() }, [fetchConvo])

  // Workspace members for the assignee dropdown + current user id so we
  // can highlight "you" and offer Claim. One-shot — assigning rarely
  // changes the member list and the dropdown re-renders on toggle.
  useEffect(() => {
    ;(async () => {
      try {
        const [meRes, membersRes] = await Promise.all([
          fetch('/api/me'),
          fetch(`/api/workspaces/${workspaceId}/members`),
        ])
        const me = await meRes.json()
        const m = await membersRes.json()
        if (me?.user?.id) setMeId(me.user.id)
        if (Array.isArray(m?.members)) setMembers(m.members)
      } catch { /* dropdown will fall back to "Claim" only */ }
    })()
  }, [workspaceId])

  async function assignTo(userId: string | null, claim = false) {
    if (assigning) return
    setAssigning(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(claim ? { claim: true } : { userId }),
      })
      if (res.ok) {
        // Optimistic — SSE assignment_changed will reconcile, but the
        // dropdown should close immediately so it feels responsive.
        setAssigneeOpen(false)
      }
    } finally {
      setAssigning(false)
    }
  }

  // SSE: replace polling with a live subscription so the operator sees
  // every visitor turn, agent turn, typing event, and status change the
  // moment it happens.
  useEffect(() => {
    if (!conversationId) return
    const url = `/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/stream`
    const es = new EventSource(url)
    esRef.current = es
    es.onopen = () => setDisconnected(false)
    es.onmessage = (e) => {
      setDisconnected(false)
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'agent_message') {
          setConvo(c => c ? { ...c, messages: appendOrReplace(c.messages, {
            id: data.id, role: 'agent', content: data.content, kind: data.kind || 'text',
            createdAt: data.createdAt, fromHuman: !!data.fromHuman, quickReplies: data.quickReplies,
          }) } : c)
          setAgentTyping({ active: false, fromHuman: false })
        } else if (data.type === 'visitor_message') {
          setConvo(c => c ? { ...c, messages: appendOrReplace(c.messages, {
            id: data.id, role: 'visitor', content: data.content, kind: data.kind || 'text',
            createdAt: data.createdAt,
          }) } : c)
          setVisitorTyping(false)
        } else if (data.type === 'agent_typing') {
          setAgentTyping({ active: !!data.isTyping, fromHuman: !!data.fromHuman })
        } else if (data.type === 'visitor_typing') {
          setVisitorTyping(!!data.isTyping)
        } else if (data.type === 'status_changed') {
          setConvo(c => c ? { ...c, status: data.status } : c)
        } else if (data.type === 'assignment_changed') {
          setConvo(c => {
            if (!c) return c
            // The SSE event carries the bare assignee (id + name). To
            // hydrate the avatar we look the user up in our members
            // cache; if they're not there (e.g. just joined) we fall
            // back to a name-only stub.
            const matched = members.find(m => m.user.id === data.assignedUserId)
            return {
              ...c,
              assignedUserId: data.assignedUserId,
              assignedAt: data.at ?? null,
              assignmentReason: data.reason ?? null,
              assignedUser: data.assignedUserId
                ? matched
                  ? { id: matched.user.id, name: matched.user.name, email: matched.user.email, image: matched.user.image }
                  : { id: data.assignedUserId, name: data.assigneeName ?? null, email: null, image: null }
                : null,
            }
          })
        } else if (data.type === 'agent_error') {
          setConvo(c => c ? { ...c, messages: [...c.messages, {
            id: 'err-' + Date.now(), role: 'system', content: data.message || 'Agent error', kind: 'text',
            createdAt: new Date().toISOString(),
          }] } : c)
        }
      } catch {}
    }
    let dropTimer: any = null
    es.onerror = () => {
      if (dropTimer) return
      dropTimer = setTimeout(() => {
        if (es.readyState !== EventSource.OPEN) setDisconnected(true)
        dropTimer = null
      }, 3000)
    }
    return () => { es.close(); esRef.current = null }
  }, [workspaceId, conversationId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [convo?.messages.length, visitorTyping, agentTyping])

  function pingTyping() {
    if (!conversationId) return
    const now = Date.now()
    if (now - lastTypingPing.current > 2000) {
      lastTypingPing.current = now
      fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/typing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: true }),
      }).catch(() => {})
    }
    if (typingPingTimer.current) clearTimeout(typingPingTimer.current)
    typingPingTimer.current = setTimeout(() => {
      fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/typing`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: false }),
      }).catch(() => {})
      lastTypingPing.current = 0
    }, 4000)
  }

  async function send() {
    if (!reply.trim() || sending) return
    setSending(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reply.trim() }),
      })
      setReply('')
    } finally { setSending(false) }
  }

  async function uploadFile(file: File) {
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    try {
      await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/upload`, {
        method: 'POST', body: form,
      })
    } finally { setUploading(false) }
  }

  async function setStatus(next: 'active' | 'handed_off' | 'ended') {
    setStatusBusy(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/messages`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
    } finally { setStatusBusy(false) }
  }

  if (loading) return (
    <div className="flex-1 p-8">
      <div className="max-w-6xl mx-auto space-y-3">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="h-96 bg-zinc-900/40 rounded-xl border border-zinc-800 animate-pulse" />
      </div>
    </div>
  )
  if (!convo) return <div className="p-8 text-zinc-500">Conversation not found</div>

  const accent = convo.widget.primaryColor || '#fa4d2e'
  const visitorLabel = convo.visitor.name || convo.visitor.email || 'Anonymous visitor'
  const visitorInitial = (convo.visitor.name || convo.visitor.email || 'V').charAt(0).toUpperCase()
  const isLive = convo.status === 'active'
  const isHandedOff = convo.status === 'handed_off'
  const isEnded = convo.status === 'ended'
  let lastAgentIdx = -1
  for (let i = convo.messages.length - 1; i >= 0; i--) {
    if (convo.messages[i].role === 'agent') { lastAgentIdx = i; break }
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-3 border-b border-zinc-800 flex items-center gap-3 flex-shrink-0 bg-zinc-950">
          {onClose ? (
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-300"
              title="Close conversation panel"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          ) : (
            <Link href={`/dashboard/${workspaceId}/inbox`} className="text-zinc-500 hover:text-zinc-300" title="Back to inbox">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
          )}
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
              {visitorInitial}
            </div>
            {isLive && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">{visitorLabel}</p>
            <p className="text-[11px] text-zinc-500 truncate">
              via <Link href={`/dashboard/${workspaceId}/widgets/${convo.widget.id}`} className="hover:text-zinc-300">{convo.widget.name}</Link>
              {convo.visitor.email && <> · {convo.visitor.email}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-medium px-2 py-1 rounded-full ${
              isHandedOff ? 'bg-orange-500/10 text-orange-400'
              : isEnded ? 'bg-zinc-800 text-zinc-500'
              : 'bg-emerald-500/10 text-emerald-400'
            }`}>
              {isHandedOff ? 'Taken over' : isEnded ? 'Ended' : 'Active'}
            </span>

            {/* Assignee dropdown — shows current assignee, opens to a
                searchable list of workspace members. Owner of the chat
                is the workspace member who claimed/was-routed to it. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setAssigneeOpen(o => !o)}
                disabled={assigning || isEnded}
                className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg border transition-colors disabled:opacity-40 ${
                  convo.assignedUserId
                    ? 'border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500'
                    : 'border-dashed border-zinc-700 bg-transparent text-zinc-400 hover:text-white hover:border-zinc-500'
                }`}
              >
                {convo.assignedUser?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={convo.assignedUser.image} alt="" className="w-4 h-4 rounded-full" />
                ) : (
                  <span className="w-4 h-4 rounded-full bg-zinc-700 flex items-center justify-center text-[9px] font-semibold text-white">
                    {(convo.assignedUser?.name || convo.assignedUser?.email || '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="truncate max-w-[120px]">
                  {!convo.assignedUserId
                    ? 'Unassigned'
                    : convo.assignedUserId === meId
                      ? 'You'
                      : (convo.assignedUser?.name || convo.assignedUser?.email || 'Assignee')}
                </span>
                <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {assigneeOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAssigneeOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 w-64 max-h-80 overflow-y-auto bg-zinc-950 border border-zinc-700 rounded-lg shadow-xl py-1">
                    {/* Quick "Claim" — only visible if the chat isn't already mine */}
                    {meId && convo.assignedUserId !== meId && (
                      <button
                        type="button"
                        onClick={() => assignTo(null, true)}
                        className="w-full text-left px-3 py-2 text-xs text-orange-300 hover:bg-orange-500/10 flex items-center gap-2 border-b border-zinc-800"
                      >
                        <span className="w-5 h-5 rounded-full bg-orange-500/20 text-orange-300 flex items-center justify-center">→</span>
                        <span className="font-medium">Claim this chat</span>
                      </button>
                    )}
                    {convo.assignedUserId && (
                      <button
                        type="button"
                        onClick={() => assignTo(null)}
                        className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-white flex items-center gap-2 border-b border-zinc-800"
                      >
                        <span className="w-5 h-5 rounded-full border border-dashed border-zinc-600 flex items-center justify-center">×</span>
                        Unassign
                      </button>
                    )}
                    {members.length === 0 && (
                      <div className="px-3 py-3 text-xs text-zinc-500">No teammates yet — invite from Members.</div>
                    )}
                    {members.map(m => {
                      const isCurrent = m.user.id === convo.assignedUserId
                      const isMe = m.user.id === meId
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => assignTo(m.user.id)}
                          disabled={isCurrent}
                          className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 ${
                            isCurrent ? 'bg-zinc-900/60 text-zinc-500' : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                          }`}
                        >
                          {m.user.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.user.image} alt="" className="w-5 h-5 rounded-full" />
                          ) : (
                            <span className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center text-[9px] font-semibold text-white">
                              {(m.user.name || m.user.email || '?').charAt(0).toUpperCase()}
                            </span>
                          )}
                          <span className="flex-1 min-w-0 truncate">
                            {m.user.name || m.user.email || 'Unnamed'}
                            {isMe && <span className="ml-1 text-zinc-500">(you)</span>}
                          </span>
                          {m.isAvailable === false && (
                            <span className="text-[9px] text-zinc-500 px-1 py-0.5 rounded bg-zinc-900 border border-zinc-700">away</span>
                          )}
                          {isCurrent && (
                            <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </>
              )}
            </div>

            {!isEnded && (
              <button
                onClick={() => setStatus('ended')}
                disabled={statusBusy}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40"
              >
                Mark resolved
              </button>
            )}
            {isEnded && (
              <button
                onClick={() => setStatus('active')}
                disabled={statusBusy}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40"
              >
                Reopen
              </button>
            )}
          </div>
        </div>

        {disconnected && (
          <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/30 text-[11px] text-amber-300">
            Live updates dropped — the page will keep retrying.
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-3">
          {convo.messages.map((m, idx) => (
            <MessageBubble
              key={m.id}
              msg={m}
              accent={accent}
              showQuickReplies={idx === lastAgentIdx && !!m.quickReplies?.length}
            />
          ))}
          {visitorTyping && (
            <div className="flex justify-start">
              <div className="bg-zinc-800 px-3 py-2 rounded-2xl rounded-tl-sm text-xs text-zinc-400 inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                <span className="ml-1">visitor typing</span>
              </div>
            </div>
          )}
          {agentTyping.active && (
            <div className="flex justify-end">
              <div className="px-3 py-2 rounded-2xl rounded-tr-sm text-xs text-white inline-flex items-center gap-1.5"
                style={{ background: accent }}>
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-bounce" style={{ animationDelay: '300ms' }} />
                <span className="ml-1">{agentTyping.fromHuman ? 'someone' : 'AI'} typing</span>
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        {!isEnded ? (
          <div className="p-4 border-t border-zinc-800 flex-shrink-0 bg-zinc-950">
            <div className="max-w-3xl mx-auto">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">
                {isHandedOff
                  ? "You've taken over — replying as yourself"
                  : 'Jump in — sending here pauses the AI and takes over'}
              </p>
              <div className="flex items-end gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  hidden
                  onChange={e => { const f = e.target.files?.[0]; if (f) void uploadFile(f); if (e.target) e.target.value = '' }}
                  accept="image/*,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  title="Attach a file"
                  className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setEmojiOpen(o => !o)}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                    title="Emoji"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  {emojiOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setEmojiOpen(false)} />
                      <div className="absolute bottom-11 left-0 z-40 bg-zinc-950 border border-zinc-700 rounded-lg p-2 shadow-xl grid grid-cols-8 gap-1 w-[260px]">
                        {EMOJI_GRID.map(e => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => { setReply(prev => prev + e); setEmojiOpen(false) }}
                            className="text-lg w-8 h-8 hover:bg-zinc-800 rounded transition-colors"
                          >{e}</button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <textarea
                  value={reply}
                  onChange={e => { setReply(e.target.value); pingTyping() }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                  placeholder="Type your reply…"
                  rows={2}
                  className="flex-1 resize-none bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 max-h-32"
                />
                <button
                  onClick={send}
                  disabled={!reply.trim() || sending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                  style={{ background: accent }}
                >
                  {sending ? '…' : 'Send'}
                </button>
              </div>
              {uploading && <p className="text-[11px] text-zinc-500 mt-2">Uploading…</p>}
            </div>
          </div>
        ) : (
          <div className="p-4 border-t border-zinc-800 flex-shrink-0 text-center text-xs text-zinc-500 bg-zinc-950">
            This conversation is closed. Click <button onClick={() => setStatus('active')} className="text-zinc-300 underline hover:text-white">Reopen</button> to follow up.
          </div>
        )}
      </div>

      {/* Right sidebar */}
      <aside className="w-72 border-l border-zinc-800 overflow-y-auto bg-zinc-950 hidden lg:block">
        <div className="p-5 border-b border-zinc-800">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-3">Visitor</p>
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold text-white"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
              {visitorInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{visitorLabel}</p>
              {convo.visitor.email && (
                <p className="text-[11px] text-zinc-400 truncate font-mono">{convo.visitor.email}</p>
              )}
              {convo.visitor.phone && (
                <p className="text-[11px] text-zinc-400 truncate font-mono">{convo.visitor.phone}</p>
              )}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <p className="text-zinc-500">First seen</p>
              <p className="text-zinc-200">{relTime(convo.visitor.firstSeenAt)}</p>
            </div>
            <div className="p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              <p className="text-zinc-500">Conversations</p>
              <p className="text-zinc-200">{convo.visitorConversationCount ?? 1}</p>
            </div>
          </div>
        </div>

        {typeof convo.csatRating === 'number' && (
          <div className="p-5 border-b border-zinc-800">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Rating for this chat</p>
            <p className="text-2xl font-bold text-amber-300">
              {'⭐'.repeat(convo.csatRating)}
              <span className="text-zinc-500 text-sm font-normal ml-2">{convo.csatRating}/5</span>
            </p>
            {convo.csatComment && (
              <p className="text-xs text-zinc-300 mt-2 italic">&ldquo;{convo.csatComment}&rdquo;</p>
            )}
            {convo.csatSubmittedAt && (
              <p className="text-[10px] text-zinc-600 mt-1">Submitted {relTime(convo.csatSubmittedAt)}</p>
            )}
          </div>
        )}

        {convo.csatHistory && convo.csatHistory.length > 1 && (
          <div className="p-5 border-b border-zinc-800">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Past ratings</p>
            <div className="space-y-1">
              {convo.csatHistory.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className="text-amber-300">{'⭐'.repeat(c.rating)}</span>
                  <span className="text-zinc-500">{c.submittedAt ? relTime(c.submittedAt) : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="p-5 border-b border-zinc-800">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Assignment</p>
          {convo.assignedUserId ? (
            <div className="flex items-start gap-2">
              {convo.assignedUser?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={convo.assignedUser.image} alt="" className="w-8 h-8 rounded-full" />
              ) : (
                <span className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-semibold text-white">
                  {(convo.assignedUser?.name || convo.assignedUser?.email || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">
                  {convo.assignedUserId === meId ? 'You' : (convo.assignedUser?.name || convo.assignedUser?.email || 'Assigned')}
                </p>
                {convo.assignmentReason && (
                  <p className="text-[10px] text-zinc-500">
                    {convo.assignmentReason === 'self' ? 'Self-claimed by replying'
                      : convo.assignmentReason === 'manual' ? 'Manually assigned'
                      : convo.assignmentReason === 'round_robin' ? 'Routed via round-robin'
                      : convo.assignmentReason === 'first_available' ? 'Routed by load (first available)'
                      : convo.assignmentReason === 'handover' ? 'Routed at AI handover'
                      : convo.assignmentReason}
                  </p>
                )}
                {convo.assignedAt && (
                  <p className="text-[10px] text-zinc-600">{relTime(convo.assignedAt)}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              No one assigned yet. Click the assignee badge in the header to claim or hand off.
            </p>
          )}
        </div>

        <div className="p-5">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Conversation</p>
          <div className="space-y-1 text-[11px]">
            <Row k="Started" v={formatTime(convo.createdAt)} />
            <Row k="Last activity" v={relTime(convo.lastMessageAt)} />
            <Row k="Messages" v={String(convo.messages.length)} />
            <Row k="Status" v={isHandedOff ? 'Taken over' : isEnded ? 'Ended' : 'Active'} />
          </div>
        </div>
      </aside>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{k}</span>
      <span className="text-zinc-300">{v}</span>
    </div>
  )
}

function appendOrReplace(messages: Message[], next: Message): Message[] {
  if (messages.some(m => m.id === next.id)) return messages
  return [...messages, next]
}

function MessageBubble({ msg, accent, showQuickReplies }: { msg: Message; accent: string; showQuickReplies: boolean }) {
  if (msg.role === 'system') {
    return (
      <div className="text-center">
        <span className="text-[10px] text-amber-300/80 italic bg-amber-500/5 border border-amber-500/20 px-2 py-1 rounded">
          {msg.content}
        </span>
      </div>
    )
  }
  const isVisitor = msg.role === 'visitor'

  if (msg.kind === 'image') {
    return (
      <div className={`flex ${isVisitor ? 'justify-start' : 'justify-end'}`}>
        <a
          href={msg.content}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-[60%] block rounded-2xl overflow-hidden border border-zinc-700 hover:border-zinc-500 transition-colors"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={msg.content} alt="attachment" className="block w-full h-auto" />
        </a>
      </div>
    )
  }
  if (msg.kind === 'file') {
    let meta: { url: string; name: string } | null = null
    try { meta = JSON.parse(msg.content) } catch {}
    if (meta?.url) {
      return (
        <div className={`flex ${isVisitor ? 'justify-start' : 'justify-end'}`}>
          <a
            href={meta.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`max-w-[70%] flex items-center gap-2 px-3 py-2 rounded-2xl text-sm border ${
              isVisitor
                ? 'rounded-tl-sm bg-zinc-800 border-zinc-700 text-zinc-100'
                : 'rounded-tr-sm border-white/20 text-white'
            }`}
            style={!isVisitor ? { background: accent } : undefined}
          >
            <span className="text-base leading-none">📎</span>
            <span className="truncate">{meta.name}</span>
          </a>
        </div>
      )
    }
  }

  return (
    <div className={`flex ${isVisitor ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[70%]">
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
            isVisitor ? 'rounded-tl-sm bg-zinc-800 text-zinc-100' : 'rounded-tr-sm text-white'
          }`}
          style={!isVisitor ? { background: accent } : undefined}
        >
          {msg.content}
        </div>
        <div className={`flex items-center gap-1.5 mt-1 ${isVisitor ? 'justify-start' : 'justify-end'}`}>
          {!isVisitor && msg.fromHuman !== undefined && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${
              msg.fromHuman ? 'bg-orange-500/10 text-orange-400' : 'bg-zinc-800 text-zinc-500'
            }`}>
              {msg.fromHuman ? '👤 you' : '🤖 AI'}
            </span>
          )}
          <p className="text-[10px] text-zinc-600">{formatTime(msg.createdAt)}</p>
        </div>
        {showQuickReplies && msg.quickReplies && msg.quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 justify-end">
            {msg.quickReplies.map(qr => (
              <span
                key={qr}
                className="text-[10px] px-2 py-1 rounded-full border opacity-60"
                style={{ borderColor: accent, color: accent }}
                title="Quick-reply chip the visitor saw"
              >{qr}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
