'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'

interface WidgetConfig {
  id: string
  name: string
  primaryColor: string
  logoUrl: string | null
  title: string
  subtitle: string
  welcomeMessage: string
  position: string
  requireEmail: boolean
  askForNameEmail: boolean
  voiceEnabled: boolean
}

interface Msg {
  id: string
  role: 'visitor' | 'agent' | 'system'
  content: string
  kind?: string
  createdAt?: string
}

const VISITOR_KEY = 'voxility_visitor_id'

export default function WidgetEmbedPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const widgetId = params.widgetId as string
  const publicKey = searchParams.get('pk') || ''

  const [config, setConfig] = useState<WidgetConfig | null>(null)
  const [visitorId, setVisitorId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [typing, setTyping] = useState(false)
  const [needsIdentity, setNeedsIdentity] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [voiceOpen, setVoiceOpen] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  // Generate/restore stable cookieId
  function getCookieId(): string {
    if (typeof window === 'undefined') return ''
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      try { localStorage.setItem(VISITOR_KEY, id) } catch {}
    }
    return id
  }

  // Step 1: load widget config
  useEffect(() => {
    if (!widgetId || !publicKey) return
    fetch(`/api/widget/${widgetId}/config?pk=${publicKey}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        setConfig(data)
        // If widget requires identity, show the form
        if (data.requireEmail) setNeedsIdentity(true)
        else if (data.askForNameEmail) {
          // Soft prompt — but still allow chat
        }
      })
      .catch(e => setError(e.message))
  }, [widgetId, publicKey])

  // Step 2: create/load visitor after config loads (if we don't need forced identity)
  useEffect(() => {
    if (!config || !widgetId || needsIdentity) return
    const cookieId = getCookieId()
    if (!cookieId) return
    fetch(`/api/widget/${widgetId}/visitor?pk=${publicKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookieId, email: email || undefined, name: name || undefined }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error)
        else setVisitorId(data.visitorId)
      })
  }, [config, widgetId, publicKey, needsIdentity])

  // Step 3: open/resume conversation
  useEffect(() => {
    if (!visitorId || !widgetId) return
    fetch(`/api/widget/${widgetId}/conversations?pk=${publicKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        setConversationId(data.conversationId)
        // Seed messages with any existing + welcome
        const existing: Msg[] = data.messages || []
        if (existing.length === 0 && config?.welcomeMessage) {
          setMessages([{ id: 'welcome', role: 'agent', content: config.welcomeMessage }])
        } else {
          setMessages(existing)
        }
      })
  }, [visitorId, widgetId, publicKey, config])

  // Step 4: connect SSE once we have a conversationId
  useEffect(() => {
    if (!conversationId || !widgetId) return
    const url = `/api/widget/${widgetId}/conversations/${conversationId}/stream?pk=${encodeURIComponent(publicKey)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'agent_message') {
          setMessages(m => [...m, { id: data.id, role: 'agent', content: data.content, createdAt: data.createdAt }])
        } else if (data.type === 'visitor_message') {
          setMessages(m => {
            // Avoid duplicate if we already optimistically added it
            if (m.some(x => x.id === data.id)) return m
            return [...m, { id: data.id, role: 'visitor', content: data.content, createdAt: data.createdAt }]
          })
        } else if (data.type === 'agent_typing') {
          setTyping(!!data.isTyping)
        } else if (data.type === 'agent_error') {
          setMessages(m => [...m, { id: 'err-' + Date.now(), role: 'system', content: data.message || 'Something went wrong.' }])
        }
      } catch {}
    }
    es.onerror = () => {
      // EventSource will auto-reconnect; we don't need to surface this
    }
    return () => { es.close(); esRef.current = null }
  }, [conversationId, widgetId, publicKey])

  // Auto-scroll on new message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typing])

  async function submitIdentity(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    const cookieId = getCookieId()
    setSending(true)
    try {
      const res = await fetch(`/api/widget/${widgetId}/visitor?pk=${publicKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookieId, email, name }),
      })
      const data = await res.json()
      if (data.visitorId) { setVisitorId(data.visitorId); setNeedsIdentity(false) }
      else setError(data.error || 'Failed to start chat')
    } finally { setSending(false) }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    const content = input.trim()
    if (!content || !conversationId || sending) return
    setSending(true)
    const optimisticId = 'opt-' + Date.now()
    setMessages(m => [...m, { id: optimisticId, role: 'visitor', content }])
    setInput('')
    try {
      await fetch(`/api/widget/${widgetId}/conversations/${conversationId}/messages?pk=${publicKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
    } catch (err: any) {
      setError('Failed to send — check your connection')
    } finally { setSending(false) }
  }

  if (error && !config) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-zinc-950 text-zinc-300 text-sm">
        <div className="max-w-sm text-center">
          <p className="text-red-400 font-semibold mb-2">Chat unavailable</p>
          <p className="text-zinc-500">{error}</p>
        </div>
      </div>
    )
  }
  if (!config) {
    return <div className="min-h-screen bg-zinc-950" />
  }

  const accent = config.primaryColor

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3 border-b border-zinc-800" style={{ background: `linear-gradient(135deg, ${accent}25, ${accent}10)` }}>
        {config.logoUrl ? (
          <img src={config.logoUrl} alt="" className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: accent, color: '#fff' }}>
            {config.title.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{config.title}</p>
          <p className="text-[11px] text-zinc-400 truncate">{config.subtitle}</p>
        </div>
        {config.voiceEnabled && (
          <button
            onClick={() => setVoiceOpen(true)}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
            title="Start voice call"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </button>
        )}
      </div>

      {/* Identity form (hard-gated) */}
      {needsIdentity && !visitorId ? (
        <form onSubmit={submitIdentity} className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <h2 className="text-base font-semibold mb-1">Let&apos;s get started</h2>
          <p className="text-xs text-zinc-400 mb-5">Leave your details and we&apos;ll reply right here.</p>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your name (optional)"
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 mb-2 focus:outline-none focus:border-zinc-500"
          />
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="Email *"
            required
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 mb-3 focus:outline-none focus:border-zinc-500"
          />
          <button
            type="submit"
            disabled={!email.trim() || sending}
            className="w-full max-w-sm py-2.5 rounded-lg text-sm font-semibold text-white hover:opacity-90 transition-colors disabled:opacity-50"
            style={{ background: accent }}
          >
            {sending ? 'Starting…' : 'Start chat'}
          </button>
        </form>
      ) : (
        <>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map(m => (
              <MessageBubble key={m.id} msg={m} accent={accent} />
            ))}
            {typing && (
              <div className="flex gap-1.5 pl-2">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
          </div>

          {/* Composer */}
          <form onSubmit={sendMessage} className="p-3 border-t border-zinc-800 bg-zinc-900/40">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e as any) }
                }}
                placeholder="Type a message…"
                rows={1}
                disabled={!conversationId || sending}
                className="flex-1 resize-none bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 max-h-24"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="w-9 h-9 rounded-full flex items-center justify-center text-white disabled:opacity-40 hover:opacity-90 transition-opacity"
                style={{ background: accent }}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </div>
            <p className="text-[9px] text-zinc-600 text-center mt-2">Powered by Voxility</p>
          </form>
        </>
      )}

      {/* Voice modal (wave 5 will wire this up) */}
      {voiceOpen && (
        <div className="absolute inset-0 bg-zinc-950/95 flex flex-col items-center justify-center p-6 z-10">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mb-4" style={{ background: `${accent}20` }}>
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={accent} strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
            </svg>
          </div>
          <p className="text-sm font-semibold mb-1">Voice calling</p>
          <p className="text-xs text-zinc-500 text-center mb-5 max-w-xs">Coming in the next update — click to call will go live when voice is fully wired.</p>
          <button
            onClick={() => setVoiceOpen(false)}
            className="text-xs px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
          >
            Back to chat
          </button>
        </div>
      )}
    </div>
  )
}

function MessageBubble({ msg, accent }: { msg: Msg; accent: string }) {
  if (msg.role === 'system') {
    return (
      <div className="text-center">
        <span className="text-[10px] text-zinc-500 italic">{msg.content}</span>
      </div>
    )
  }
  const isVisitor = msg.role === 'visitor'
  return (
    <div className={`flex ${isVisitor ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
          isVisitor ? 'rounded-tr-sm text-white' : 'rounded-tl-sm bg-zinc-800 text-zinc-100'
        }`}
        style={isVisitor ? { background: accent } : undefined}
      >
        {msg.content}
      </div>
    </div>
  )
}
