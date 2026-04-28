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
  /** Optional click-to-send chips offered by the agent. */
  quickReplies?: string[]
}

const EMOJI_GRID = ['👍', '🙏', '😀', '😅', '🎉', '💯', '🔥', '✅', '❌', '👀', '❤️', '🤔', '👋', '✨', '⏰', '📅']

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
  const [voiceState, setVoiceState] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [voiceCallId, setVoiceCallId] = useState<string | null>(null)

  // New visitor controls
  const [menuOpen, setMenuOpen] = useState(false)
  const [transcriptDialogOpen, setTranscriptDialogOpen] = useState(false)
  const [transcriptEmail, setTranscriptEmail] = useState('')
  const [transcriptStatus, setTranscriptStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [transcriptSending, setTranscriptSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [dictating, setDictating] = useState(false)
  const dictationRef = useRef<any>(null)

  // CSAT
  const [csatOpen, setCsatOpen] = useState(false)
  const [csatRating, setCsatRating] = useState(0)
  const [csatComment, setCsatComment] = useState('')
  const [csatStatus, setCsatStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [csatSubmitting, setCsatSubmitting] = useState(false)

  // Connection / emoji / typing
  const [disconnected, setDisconnected] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const typingPingTimer = useRef<any>(null)
  const lastTypingPing = useRef<number>(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const vapiRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

    es.onopen = () => setDisconnected(false)
    es.onmessage = (e) => {
      setDisconnected(false)
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'agent_message') {
          setMessages(m => [...m, {
            id: data.id, role: 'agent', content: data.content, createdAt: data.createdAt,
            kind: data.kind,
            quickReplies: Array.isArray(data.quickReplies) ? data.quickReplies : undefined,
          }])
        } else if (data.type === 'visitor_message') {
          setMessages(m => {
            // Already have it under the real id (SSE replayed twice) — no-op
            if (m.some(x => x.id === data.id)) return m
            // Replace the optimistic copy if we sent this turn ourselves.
            const optIdx = m.findIndex(x =>
              x.role === 'visitor' &&
              x.id.startsWith('opt-') &&
              x.content === data.content
            )
            if (optIdx >= 0) {
              const next = m.slice()
              next[optIdx] = { id: data.id, role: 'visitor', content: data.content, kind: data.kind, createdAt: data.createdAt }
              return next
            }
            return [...m, { id: data.id, role: 'visitor', content: data.content, kind: data.kind, createdAt: data.createdAt }]
          })
        } else if (data.type === 'agent_typing') {
          setTyping(!!data.isTyping)
        } else if (data.type === 'agent_error') {
          setMessages(m => [...m, { id: 'err-' + Date.now(), role: 'system', content: data.message || 'Something went wrong.' }])
        }
      } catch {}
    }
    // Surface dropped connections after a short grace period so brief
    // network blips don't flicker the banner. Browser auto-retries; we
    // also expose a manual "Try again" if the visitor is impatient.
    let dropTimer: any = null
    es.onerror = () => {
      if (dropTimer) return
      dropTimer = setTimeout(() => {
        if (es.readyState !== EventSource.OPEN) setDisconnected(true)
        dropTimer = null
      }, 3000)
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

  function pingTyping() {
    if (!conversationId) return
    const now = Date.now()
    // Throttle to one ping per 2s; debounce a "stopped" ping 4s after last keystroke.
    if (now - lastTypingPing.current > 2000) {
      lastTypingPing.current = now
      fetch(`/api/widget/${widgetId}/conversations/${conversationId}/typing?pk=${publicKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: true }),
      }).catch(() => {})
    }
    if (typingPingTimer.current) clearTimeout(typingPingTimer.current)
    typingPingTimer.current = setTimeout(() => {
      fetch(`/api/widget/${widgetId}/conversations/${conversationId}/typing?pk=${publicKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isTyping: false }),
      }).catch(() => {})
      lastTypingPing.current = 0
    }, 4000)
  }

  async function sendQuickReply(text: string) {
    if (!conversationId || sending) return
    setSending(true)
    const optimisticId = 'opt-' + Date.now()
    setMessages(m => [...m, { id: optimisticId, role: 'visitor', content: text }])
    try {
      await fetch(`/api/widget/${widgetId}/conversations/${conversationId}/messages?pk=${publicKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      })
    } catch (err: any) {
      setError('Failed to send — check your connection')
    } finally { setSending(false) }
  }

  function reconnectStream() {
    setDisconnected(false)
    // Bumping conversationId effect by toggling a re-render is overkill;
    // simplest: close + null the existing ES so the conversationId effect
    // recreates it. Trick: clone setConversationId(prev => prev) doesn't
    // re-run — but closing esRef + setting a fresh value via refresh works.
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    // Toggle conversationId state to retrigger the SSE effect.
    const cur = conversationId
    setConversationId(null)
    setTimeout(() => setConversationId(cur), 0)
  }

  async function uploadFile(file: File) {
    if (!conversationId || uploading) return
    setUploading(true)
    setUploadError(null)
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(
        `/api/widget/${widgetId}/conversations/${conversationId}/upload?pk=${publicKey}`,
        { method: 'POST', body: form },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUploadError(data.error || `Upload failed (HTTP ${res.status})`)
        return
      }
      // SSE will broadcast the new visitor_message — no local insert needed.
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed')
    } finally { setUploading(false) }
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData?.items || [])
    const fileItem = items.find(it => it.kind === 'file' && it.type.startsWith('image/'))
    if (fileItem) {
      const f = fileItem.getAsFile()
      if (f) { e.preventDefault(); void uploadFile(f) }
    }
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) void uploadFile(f)
  }

  async function startNewConversation() {
    if (!visitorId) return
    setMenuOpen(false)
    try {
      const res = await fetch(`/api/widget/${widgetId}/conversations/new?pk=${publicKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId }),
      })
      const data = await res.json()
      if (data.conversationId) {
        // Drop the old SSE — new one will be opened by the conversationId effect.
        esRef.current?.close()
        esRef.current = null
        setConversationId(data.conversationId)
        setMessages(config?.welcomeMessage
          ? [{ id: 'welcome-' + Date.now(), role: 'agent', content: config.welcomeMessage }]
          : [])
      }
    } catch (err: any) {
      setError('Could not start a new chat — check your connection')
    }
  }

  async function emailTranscript(e: React.FormEvent) {
    e.preventDefault()
    if (!conversationId || !transcriptEmail.trim()) return
    setTranscriptSending(true)
    setTranscriptStatus(null)
    try {
      const res = await fetch(
        `/api/widget/${widgetId}/conversations/${conversationId}/email-transcript?pk=${publicKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: transcriptEmail.trim() }),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setTranscriptStatus({ kind: 'err', msg: data.error || 'Send failed' })
      } else {
        setTranscriptStatus({ kind: 'ok', msg: `Sent to ${data.sentTo}` })
        setTranscriptEmail('')
      }
    } catch (err: any) {
      setTranscriptStatus({ kind: 'err', msg: err?.message || 'Send failed' })
    } finally { setTranscriptSending(false) }
  }

  async function submitCsat() {
    if (!conversationId || csatRating < 1) return
    setCsatSubmitting(true)
    setCsatStatus(null)
    try {
      const res = await fetch(`/api/widget/${widgetId}/conversations/${conversationId}/csat?pk=${publicKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: csatRating, comment: csatComment.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setCsatStatus({ kind: 'err', msg: data.error || 'Could not save rating' })
        return
      }
      setCsatStatus({ kind: 'ok', msg: 'Thanks — your feedback was sent.' })
      setTimeout(() => { setCsatOpen(false); setCsatRating(0); setCsatComment(''); setCsatStatus(null) }, 1400)
    } finally { setCsatSubmitting(false) }
  }

  function toggleDictation() {
    if (typeof window === 'undefined') return
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setUploadError("Voice typing isn't supported in this browser. Try Chrome or Edge.")
      return
    }
    if (dictating) {
      try { dictationRef.current?.stop() } catch {}
      setDictating(false)
      return
    }
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    let finalText = ''
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interim += r[0].transcript
      }
      setInput((prev => {
        // Replace the last "interim" portion each tick. We track final separately.
        const base = (prev.endsWith(' ') || prev === '') ? prev : prev + ' '
        return (base + finalText + interim).trimStart()
      })(input))
    }
    rec.onerror = () => { setDictating(false) }
    rec.onend = () => { setDictating(false) }
    dictationRef.current = rec
    rec.start()
    setDictating(true)
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
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-white/10 transition-colors"
            title="More options"
            aria-label="More options"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="5" r="1.4" fill="currentColor" />
              <circle cx="12" cy="12" r="1.4" fill="currentColor" />
              <circle cx="12" cy="19" r="1.4" fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-1 w-56 rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl z-50 overflow-hidden">
                <button
                  onClick={() => { setMenuOpen(false); startNewConversation() }}
                  className="w-full text-left px-4 py-2.5 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors flex items-center gap-2"
                >
                  <span>🔄</span> Start new conversation
                </button>
                <button
                  onClick={() => { setMenuOpen(false); setMessages([]); }}
                  className="w-full text-left px-4 py-2.5 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors flex items-center gap-2 border-t border-zinc-800"
                >
                  <span>🧹</span> Clear chat (local only)
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setTranscriptStatus(null)
                    setTranscriptEmail(email || '')
                    setTranscriptDialogOpen(true)
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors flex items-center gap-2 border-t border-zinc-800"
                >
                  <span>✉️</span> Email me a transcript
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setCsatStatus(null)
                    setCsatOpen(true)
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors flex items-center gap-2 border-t border-zinc-800"
                >
                  <span>⭐</span> Rate this chat
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {disconnected && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-[11px] text-amber-300 flex items-center justify-between">
          <span>Connection dropped. Messages will deliver once you&apos;re back online.</span>
          <button
            onClick={reconnectStream}
            className="font-semibold text-amber-200 hover:text-white transition-colors"
          >Try again</button>
        </div>
      )}

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
          {/* Messages — wrapped in drag-drop target so visitors can drop a file anywhere */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-3 relative"
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {messages.map((m, idx) => {
              // Only render chips on the LAST agent message — older chips
              // shouldn't keep nudging the visitor after they've moved on.
              const isLastAgent = m.role === 'agent'
                && messages.findIndex((x, i) => i > idx && x.role === 'agent') === -1
              return (
                <div key={m.id}>
                  <MessageBubble msg={m} accent={accent} />
                  {isLastAgent && m.quickReplies && m.quickReplies.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2 pl-2">
                      {m.quickReplies.map(qr => (
                        <button
                          key={qr}
                          onClick={() => sendQuickReply(qr)}
                          disabled={sending}
                          className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:opacity-90 disabled:opacity-50"
                          style={{ borderColor: accent, color: accent }}
                        >{qr}</button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
            {typing && (
              <div className="flex gap-1.5 pl-2">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            )}
            {dragOver && (
              <div className="absolute inset-0 bg-zinc-950/85 border-2 border-dashed border-zinc-500 rounded-lg flex items-center justify-center pointer-events-none">
                <p className="text-sm text-zinc-300">Drop to attach</p>
              </div>
            )}
          </div>

          {/* Composer */}
          <form onSubmit={sendMessage} className="p-3 border-t border-zinc-800 bg-zinc-900/40">
            {uploadError && (
              <div className="mb-2 p-2 rounded border border-red-500/30 bg-red-500/5 text-[11px] text-red-300">
                {uploadError}
              </div>
            )}
            {uploading && (
              <div className="mb-2 text-[11px] text-zinc-400">Uploading…</div>
            )}
            <div className="flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                hidden
                onChange={e => {
                  const f = e.target.files?.[0]
                  if (f) void uploadFile(f)
                  if (e.target) e.target.value = ''
                }}
                accept="image/*,application/pdf,text/plain,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!conversationId || uploading}
                className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-30"
                title="Attach a file"
                aria-label="Attach a file"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                </svg>
              </button>
              <button
                type="button"
                onClick={toggleDictation}
                disabled={!conversationId}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  dictating
                    ? 'text-white animate-pulse'
                    : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
                style={dictating ? { background: accent } : undefined}
                title={dictating ? 'Stop dictation' : 'Voice typing'}
                aria-label={dictating ? 'Stop dictation' : 'Voice typing'}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
                </svg>
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setEmojiOpen(o => !o)}
                  disabled={!conversationId}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
                  title="Emoji"
                  aria-label="Emoji"
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
                          onClick={() => { setInput(prev => prev + e); setEmojiOpen(false) }}
                          className="text-lg w-8 h-8 hover:bg-zinc-800 rounded transition-colors"
                        >{e}</button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <textarea
                value={input}
                onChange={e => { setInput(e.target.value); pingTyping() }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(e as any) }
                }}
                onPaste={onPaste}
                placeholder={dictating ? 'Listening…' : 'Type a message…'}
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

      {voiceOpen && (
        <VoiceModal
          accent={accent}
          state={voiceState}
          error={voiceError}
          onStart={async () => {
            if (!conversationId) return
            setVoiceState('connecting'); setVoiceError(null)
            try {
              const res = await fetch(`/api/widget/${widgetId}/voice/start?pk=${publicKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ conversationId }),
              })
              const data = await res.json()
              if (!res.ok) throw new Error(data.error || 'Failed to start call')
              // Dynamic import so the widget bundle stays light for text-only users
              const Vapi = (await import('@vapi-ai/web')).default
              const vapi = new Vapi(data.vapiPublicKey)
              vapiRef.current = vapi
              setVoiceCallId(data.callId)
              vapi.on('call-start', () => setVoiceState('live'))
              vapi.on('call-end', () => {
                setVoiceState('idle')
                // Notify server so transcript gets written via VAPI webhook
                if (data.callId) {
                  fetch(`/api/widget/${widgetId}/voice/end?pk=${publicKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callId: data.callId }),
                  }).catch(() => {})
                }
                vapiRef.current = null
                setVoiceCallId(null)
              })
              vapi.on('error', (e: any) => {
                setVoiceState('error')
                setVoiceError(e?.message || 'Voice error')
              })
              await vapi.start(data.assistant)
            } catch (e: any) {
              setVoiceState('error')
              setVoiceError(e.message || 'Failed to start voice')
            }
          }}
          onHangup={() => {
            if (vapiRef.current) {
              try { vapiRef.current.stop() } catch {}
            }
            setVoiceState('idle')
          }}
          onClose={() => {
            if (voiceState === 'live' && vapiRef.current) {
              try { vapiRef.current.stop() } catch {}
            }
            setVoiceOpen(false)
            setVoiceState('idle')
            setVoiceError(null)
          }}
        />
      )}

      {csatOpen && (
        <div
          className="absolute inset-0 z-50 bg-zinc-950/85 backdrop-blur flex items-center justify-center p-6"
          onClick={() => setCsatOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-xl p-5 shadow-xl"
          >
            <p className="text-sm font-semibold text-white mb-1">How was this chat?</p>
            <p className="text-[11px] text-zinc-500 mb-4">Your feedback helps us train the agent.</p>
            <div className="flex justify-center gap-2 mb-4">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCsatRating(n)}
                  className="text-3xl transition-transform hover:scale-110"
                  aria-label={`${n} star${n === 1 ? '' : 's'}`}
                >
                  <span style={{ filter: n <= csatRating ? 'none' : 'grayscale(1) opacity(0.3)' }}>⭐</span>
                </button>
              ))}
            </div>
            <textarea
              value={csatComment}
              onChange={e => setCsatComment(e.target.value)}
              rows={3}
              placeholder="Anything we could do better? (optional)"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 mb-3"
            />
            {csatStatus && (
              <p className={`text-[11px] mb-2 ${csatStatus.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                {csatStatus.msg}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCsatOpen(false)}
                className="text-xs px-3 py-2 rounded-lg text-zinc-400 hover:text-white transition-colors"
              >Close</button>
              <button
                type="button"
                onClick={submitCsat}
                disabled={csatSubmitting || csatRating < 1}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ background: accent }}
              >
                {csatSubmitting ? 'Sending…' : 'Send feedback'}
              </button>
            </div>
          </div>
        </div>
      )}

      {transcriptDialogOpen && (
        <div
          className="absolute inset-0 z-50 bg-zinc-950/85 backdrop-blur flex items-center justify-center p-6"
          onClick={() => setTranscriptDialogOpen(false)}
        >
          <form
            onSubmit={emailTranscript}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm bg-zinc-900 border border-zinc-700 rounded-xl p-5 shadow-xl"
          >
            <p className="text-sm font-semibold text-white mb-1">Email me a transcript</p>
            <p className="text-[11px] text-zinc-500 mb-4">We&apos;ll send a copy of this conversation so you have a record.</p>
            <input
              type="email"
              value={transcriptEmail}
              onChange={e => setTranscriptEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 mb-3"
            />
            {transcriptStatus && (
              <p className={`text-[11px] mb-2 ${transcriptStatus.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                {transcriptStatus.msg}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTranscriptDialogOpen(false)}
                className="text-xs px-3 py-2 rounded-lg text-zinc-400 hover:text-white transition-colors"
              >Close</button>
              <button
                type="submit"
                disabled={transcriptSending || !transcriptEmail.trim()}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ background: accent }}
              >
                {transcriptSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function VoiceModal({
  accent, state, error, onStart, onHangup, onClose,
}: {
  accent: string
  state: 'idle' | 'connecting' | 'live' | 'error'
  error: string | null
  onStart: () => void
  onHangup: () => void
  onClose: () => void
}) {
  return (
    <div className="absolute inset-0 bg-zinc-950/95 backdrop-blur flex flex-col items-center justify-center p-6 z-10">
      <div
        className={`w-24 h-24 rounded-full flex items-center justify-center mb-5 transition-transform ${state === 'live' ? 'animate-pulse' : ''}`}
        style={{
          background: state === 'live' ? accent : `${accent}25`,
          boxShadow: state === 'live' ? `0 0 0 12px ${accent}20` : 'none',
        }}
      >
        <svg className={`w-10 h-10 ${state === 'live' ? 'text-white' : ''}`} fill="none" viewBox="0 0 24 24"
          stroke={state === 'live' ? '#fff' : accent} strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
        </svg>
      </div>

      <p className="text-sm font-semibold mb-1">
        {state === 'idle' && 'Ready to call'}
        {state === 'connecting' && 'Connecting…'}
        {state === 'live' && 'On the call'}
        {state === 'error' && 'Call error'}
      </p>
      <p className="text-xs text-zinc-500 text-center mb-5 max-w-xs">
        {state === 'idle' && 'You\'ll talk with our AI voice assistant. You can hang up any time.'}
        {state === 'connecting' && 'Starting a secure connection…'}
        {state === 'live' && 'Speak naturally. The assistant is listening.'}
        {state === 'error' && (error || 'Something went wrong. Please try again.')}
      </p>

      {state === 'idle' || state === 'error' ? (
        <div className="flex gap-2">
          <button
            onClick={onStart}
            className="text-sm font-semibold px-5 py-2.5 rounded-lg text-white hover:opacity-90 transition-colors"
            style={{ background: accent }}
          >
            {state === 'error' ? 'Retry' : 'Start call'}
          </button>
          <button
            onClick={onClose}
            className="text-sm font-medium px-5 py-2.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
          >
            Back to chat
          </button>
        </div>
      ) : state === 'connecting' ? (
        <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          Cancel
        </button>
      ) : (
        <button
          onClick={onHangup}
          className="text-sm font-semibold px-5 py-2.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
        >
          Hang up
        </button>
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

  // Image attachment — content is the URL, render inline.
  if (msg.kind === 'image') {
    return (
      <div className={`flex ${isVisitor ? 'justify-end' : 'justify-start'}`}>
        <a
          href={msg.content}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-[70%] block rounded-2xl overflow-hidden border border-zinc-700 hover:border-zinc-500 transition-colors"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={msg.content} alt="attachment" className="block w-full h-auto" />
        </a>
      </div>
    )
  }

  // File attachment — content is JSON { url, name, mime, size }.
  if (msg.kind === 'file') {
    let meta: { url: string; name: string; mime?: string; size?: number } | null = null
    try { meta = JSON.parse(msg.content) } catch {}
    if (meta?.url) {
      return (
        <div className={`flex ${isVisitor ? 'justify-end' : 'justify-start'}`}>
          <a
            href={meta.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`max-w-[80%] flex items-center gap-2 px-3 py-2 rounded-2xl text-sm border ${
              isVisitor
                ? 'rounded-tr-sm border-white/20 text-white'
                : 'rounded-tl-sm border-zinc-700 bg-zinc-800 text-zinc-100'
            }`}
            style={isVisitor ? { background: accent } : undefined}
          >
            <span className="text-base leading-none">📎</span>
            <span className="truncate">{meta.name}</span>
          </a>
        </div>
      )
    }
  }

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
