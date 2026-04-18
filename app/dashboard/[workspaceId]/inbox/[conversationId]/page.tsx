'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Convo {
  id: string
  status: string
  lastMessageAt: string
  createdAt: string
  widget: { id: string; name: string; primaryColor: string }
  visitor: { id: string; name: string | null; email: string | null; firstSeenAt: string }
  messages: Array<{ id: string; role: string; content: string; kind: string; createdAt: string }>
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function InboxDetailPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const conversationId = params.conversationId as string

  const [convo, setConvo] = useState<Convo | null>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchConvo = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/messages`)
    const data = await res.json()
    if (data.conversation) setConvo(data.conversation)
    setLoading(false)
  }, [workspaceId, conversationId])

  useEffect(() => { fetchConvo() }, [fetchConvo])
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
    try {
      await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: reply.trim() }),
      })
      setReply('')
      fetchConvo()
    } finally { setSending(false) }
  }

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>
  if (!convo) return <div className="p-8 text-zinc-500">Conversation not found</div>

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 py-4 border-b border-zinc-800 flex items-center gap-3 flex-shrink-0">
        <Link href={`/dashboard/${workspaceId}/inbox`} className="text-zinc-500 hover:text-zinc-300">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-sm font-semibold text-zinc-300">
          {(convo.visitor.name || convo.visitor.email || 'V').charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{convo.visitor.name || convo.visitor.email || 'Anonymous visitor'}</p>
          <p className="text-xs text-zinc-500">
            {convo.visitor.email && <span>{convo.visitor.email} · </span>}
            via <Link href={`/dashboard/${workspaceId}/widgets/${convo.widget.id}`} className="hover:underline">{convo.widget.name}</Link>
            {' · '}First seen {formatTime(convo.visitor.firstSeenAt)}
          </p>
        </div>
        {convo.status !== 'ended' && (
          <span className={`text-[10px] font-medium px-2 py-1 rounded ${
            convo.status === 'handed_off' ? 'bg-orange-500/10 text-orange-400' : 'bg-emerald-500/10 text-emerald-400'
          }`}>
            {convo.status === 'handed_off' ? 'Taken over' : 'Active'}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-8 space-y-3">
        {convo.messages.map(m => {
          const isVisitor = m.role === 'visitor'
          const isSystem = m.role === 'system'
          if (isSystem) {
            return (
              <div key={m.id} className="text-center">
                <span className="text-[10px] text-zinc-500 italic">{m.content}</span>
              </div>
            )
          }
          return (
            <div key={m.id} className={`flex ${isVisitor ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[70%]`}>
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
                    isVisitor ? 'rounded-tl-sm bg-zinc-800 text-zinc-100' : 'rounded-tr-sm text-white'
                  }`}
                  style={!isVisitor ? { background: convo.widget.primaryColor } : undefined}
                >
                  {m.content}
                </div>
                <p className={`text-[10px] text-zinc-600 mt-1 ${isVisitor ? 'text-left' : 'text-right'}`}>
                  {formatTime(m.createdAt)}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Human takeover composer */}
      <div className="p-4 border-t border-zinc-800 flex-shrink-0">
        <div className="max-w-3xl mx-auto">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">
            {convo.status === 'handed_off' ? 'You\'ve taken over — reply as yourself' : 'Jump in — sending here pauses the AI and takes over'}
          </p>
          <div className="flex items-end gap-2">
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder="Type your reply…"
              rows={2}
              className="flex-1 resize-none bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <button
              onClick={send}
              disabled={!reply.trim() || sending}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
              style={{ background: convo.widget.primaryColor }}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
