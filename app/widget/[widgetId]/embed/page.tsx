'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { buildBrandPalette } from '@/lib/brand-theme'
import { playNotificationSound } from '@/lib/notification-sound'
import { resolveVisitorCookieId } from '@/lib/widget-iframe-cookie'

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

// VISITOR_KEY moved to lib/widget-iframe-cookie.ts (VISITOR_COOKIE_KEY).
// Kept inline as a no-op so any unrelated diff stays small.

export default function WidgetEmbedPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const widgetId = params.widgetId as string
  const publicKey = searchParams.get('pk') || ''

  const [config, setConfig] = useState<WidgetConfig | null>(null)
  const [visitorId, setVisitorId] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  // 'active' = AI driving. 'handed_off' = operator took over (visitor
  // still types; AI just doesn't reply). 'ended' = operator marked
  // resolved → we disable input + show closure banner + auto-prompt
  // CSAT. Defaults to 'active' so a fresh widget without server data
  // doesn't surface a stale "ended" state on first render.
  const [conversationStatus, setConversationStatus] = useState<'active' | 'handed_off' | 'ended'>('active')
  // Set when the operator promotes this chat to a ticket. The chat
  // status flips to 'ended' alongside this, but we use ticketInfo to
  // swap the generic closure banner for a ticket-specific variant
  // that tells the visitor where the follow-up will arrive.
  const [ticketInfo, setTicketInfo] = useState<{ number: number; email: string } | null>(null)
  // Operator who's taken the chat. null = no human assigned yet (AI is
  // driving). We show a "You're chatting with {name}" banner under the
  // header whenever this is set, and inject a system message on the
  // SSE event so the chat history reads naturally.
  const [assignedHuman, setAssignedHuman] = useState<{ name: string; image: string | null } | null>(null)
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

  // Surfaced after the visitor identifies if their email matches an
  // existing visitor with a live chat — we sent them a magic link to
  // resume that thread on this device. We still let them chat in the
  // new thread in case they don't want to wait on email.
  const [recoveryEmailed, setRecoveryEmailed] = useState(false)

  // CSAT
  const [csatOpen, setCsatOpen] = useState(false)
  const [csatRating, setCsatRating] = useState(0)
  const [csatComment, setCsatComment] = useState('')
  const [csatStatus, setCsatStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null)
  const [csatSubmitting, setCsatSubmitting] = useState(false)

  // The "You're offline" banner is gated on the BROWSER's navigator.onLine,
  // not on SSE reconnect latency. A slow Vercel cold-start reconnect is
  // not "being offline" — calling it that flashed the banner on every
  // routine maxDuration cycle and was the actual user complaint. The
  // SSE reconnect machinery still runs underneath (backoff, watchdog,
  // resume via Last-Event-ID); it's just silent unless the browser
  // itself has lost network.
  const [networkOffline, setNetworkOffline] = useState(false)
  const [reconnectNonce, setReconnectNonce] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const typingPingTimer = useRef<any>(null)
  const lastTypingPing = useRef<number>(0)

  const scrollRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const vapiRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Resume cursor — the SSE `id:` of the last persisted message we
  // received. We pass it as `?since=` on manual reconnects since the
  // browser only auto-attaches Last-Event-ID on its OWN retries, not
  // on a freshly constructed EventSource.
  const lastEventIdRef = useRef<string | null>(null)
  // Watchdog — last time anything (event OR ping) arrived. If the
  // server stops talking to us without the TCP layer noticing (mobile
  // networks, suspended laptops), we'll force a reconnect ourselves.
  const lastSeenAtRef = useRef<number>(Date.now())

  // Stop dictation on unmount. Without this the SpeechRecognition
  // instance keeps the browser's mic indicator on after the widget
  // page unloads — the visitor sees a "this site is using your
  // microphone" pill in the URL bar with nothing they can do about it.
  useEffect(() => {
    return () => {
      try { dictationRef.current?.stop() } catch {}
      dictationRef.current = null
    }
  }, [])

  // Visitor cookieId comes from the shared resolver — see
  // lib/widget-iframe-cookie.ts for the full precedence rules
  // (URL `cid` > iframe localStorage > fresh).
  function getCookieId(): string {
    return resolveVisitorCookieId(searchParams.get('cid'))
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

  // Step 2: create/load visitor after config loads (if we don't need forced identity).
  //
  // Branch: if the URL carries ?recover=<token>, that's a magic link
  // back from a previous device. POST /recover swaps the original
  // WidgetVisitor's cookieId to OUR cookieId so this device picks up
  // the existing conversation + operator assignment. We strip the
  // query param after success so a refresh doesn't try to recover
  // again with the now-used token.
  useEffect(() => {
    if (!config || !widgetId || needsIdentity) return
    const cookieId = getCookieId()
    if (!cookieId) return

    const recoverToken = searchParams.get('recover')
    if (recoverToken) {
      ;(async () => {
        try {
          const res = await fetch(`/api/widget/${widgetId}/recover?pk=${publicKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: recoverToken, newCookieId: cookieId }),
          })
          const data = await res.json()
          if (res.ok && data.visitorId) {
            setVisitorId(data.visitorId)
            // Strip ?recover from the URL so a refresh doesn't replay
            // a used token (returns 410). We replace, not push, so the
            // back button doesn't bounce them back here.
            try {
              const u = new URL(window.location.href)
              u.searchParams.delete('recover')
              window.history.replaceState(null, '', u.pathname + u.search + u.hash)
            } catch {}
            return
          }
          // Token expired / used / invalid → fall through to the
          // normal identify so the visitor still has a working chat
          // (just under a fresh thread).
          console.warn('[widget] recovery failed:', data.error)
        } catch (err: any) {
          console.warn('[widget] recovery call failed:', err?.message)
        }
        // Fallthrough to the regular identify path
        identifyFresh()
      })()
      return
    }

    identifyFresh()

    function identifyFresh() {
      fetch(`/api/widget/${widgetId}/visitor?pk=${publicKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookieId, email: email || undefined, name: name || undefined }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.error) setError(data.error)
          else setVisitorId(data.visitorId)
          if (data.recoveryEmailed) setRecoveryEmailed(true)
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, widgetId, publicKey, needsIdentity])

  // Step 3: open/resume conversation
  useEffect(() => {
    if (!visitorId || !widgetId) return
    // Capture WHERE the visitor started this chat. Frozen on the server
    // at conversation-create time so operators see the original landing
    // page even after the visitor has navigated elsewhere mid-chat.
    const initiatedUrl = typeof window !== 'undefined' ? window.location.href : null
    const initiatedTitle = typeof document !== 'undefined' ? (document.title || null) : null
    fetch(`/api/widget/${widgetId}/conversations?pk=${publicKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitorId, initiatedUrl, initiatedTitle }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); return }
        setConversationId(data.conversationId)
        if (data.status === 'active' || data.status === 'handed_off' || data.status === 'ended') {
          setConversationStatus(data.status)
        }
        // Restore the "chatting with {name}" banner if a human had
        // already taken the chat before this page load.
        if (data.assignedUser && typeof data.assignedUser.name === 'string') {
          setAssignedHuman({
            name: data.assignedUser.name,
            image: typeof data.assignedUser.image === 'string' ? data.assignedUser.image : null,
          })
        }
        // Seed messages with any existing + welcome
        const existing: Msg[] = data.messages || []
        if (existing.length === 0 && config?.welcomeMessage) {
          setMessages([{ id: 'welcome', role: 'agent', content: config.welcomeMessage }])
        } else {
          setMessages(existing)
        }
      })
  }, [visitorId, widgetId, publicKey, config])

  // Step 4: connect SSE once we have a conversationId.
  //
  // Connection model:
  //   • The server's `maxDuration = 300` means the stream cycles every
  //     ~5 min. The browser's EventSource transparently reconnects and
  //     re-sends `Last-Event-ID`, so the server can backfill any
  //     messages broadcast during the gap. The visitor sees nothing.
  //   • If EventSource hits CLOSED (browser gave up after several
  //     internal retries), we take over with our own exponential backoff
  //     so we don't sit dead. STILL no banner — the visitor's POSTs
  //     still work, missed messages will replay on the next successful
  //     reconnect, and "the realtime stream is down" is not visitor UX.
  //   • Watchdog catches silent TCP deaths via the server's periodic
  //     ping events.
  //   • The "You're offline" banner is driven SOLELY by the browser's
  //     online/offline events. Reconnect latency is never called offline.
  useEffect(() => {
    if (!conversationId || !widgetId) return

    const STALE_THRESHOLD_MS = 35000    // no event/ping → assume dead, force reconnect
    const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 10000, 30000]
    let backoffTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const buildUrl = () => {
      const base = `/api/widget/${widgetId}/conversations/${conversationId}/stream?pk=${encodeURIComponent(publicKey)}`
      const since = lastEventIdRef.current
      return since ? `${base}&since=${encodeURIComponent(since)}` : base
    }

    const clearBackoff = () => {
      if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null }
    }

    // Seed the banner from the current navigator state so a refresh
    // mid-offline shows the right thing.
    if (typeof navigator !== 'undefined') setNetworkOffline(!navigator.onLine)
    let attempt = 0

    const handleEvent = (data: any) => {
      if (data.type === 'ping') return
      if (data.type === 'hello' || data.type === 'resume_truncated') return
      if (data.type === 'agent_message') {
        setMessages(m => {
          if (m.some(x => x.id === data.id)) return m
          // Notification ping. SSE only delivers NEW events (history
          // comes via the POST /conversations response), so we don't
          // need to filter out replayed messages — the throttle in
          // playNotificationSound handles bursty backfills on reconnect.
          playNotificationSound('widget')
          return [...m, {
            id: data.id, role: 'agent', content: data.content, createdAt: data.createdAt,
            kind: data.kind,
            quickReplies: Array.isArray(data.quickReplies) ? data.quickReplies : undefined,
          }]
        })
      } else if (data.type === 'visitor_message') {
        setMessages(m => {
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
      } else if (data.type === 'assignment_changed') {
        // An operator just picked up (or released) the chat. Server
        // sends { assignedUserId, assigneeName, reason, at }. We don't
        // care about the userId (visitors have no notion of internal
        // user IDs) — we just want the display name + a system message
        // so the chat history reads "Sam joined the chat".
        const rawName = typeof data.assigneeName === 'string' ? data.assigneeName.trim() : ''
        if (data.assignedUserId && rawName) {
          // First-name only (with safe fallback to the full string when
          // there's no whitespace). Matches what the POST endpoint does
          // so the SSE-driven banner and the reload-driven banner show
          // the same thing.
          const display = rawName.split(/\s+/)[0]
          setAssignedHuman(prev => {
            if (prev && prev.name === display) return prev
            // Only inject a system message when the name actually
            // changed — re-broadcasts on reconnect should be silent.
            setMessages(m => [...m, {
              id: 'sys-assigned-' + Date.now(),
              role: 'system',
              content: `${display} from our team joined the chat.`,
            }])
            return { name: display, image: null }
          })
        } else if (!data.assignedUserId) {
          // Unassigned (operator handed it back). Clear the banner;
          // we don't message the visitor about it — the chat just
          // returns to the AI / queue without UX noise.
          setAssignedHuman(null)
        }
      } else if (data.type === 'ticket_created') {
        // Operator promoted this chat to a ticket. Stash the ticket
        // number + contact email so the closure card (about to be
        // shown when the follow-up status_changed → 'ended' lands)
        // can read "We've created ticket #N — we'll follow up via
        // email at <email>" instead of the generic "This chat has
        // ended."
        const num = Number((data as { ticketNumber?: number }).ticketNumber)
        const email = (data as { contactEmail?: string }).contactEmail
        if (Number.isFinite(num) && email) {
          setTicketInfo({ number: num, email })
        }
      } else if (data.type === 'status_changed') {
        // Operator changed the conversation status. 'ended' → show
        // closure banner + auto-prompt CSAT (if not already shown).
        // 'handed_off' → quiet update (we don't currently show a
        // visible cue for "operator took over"; visitor experiences
        // it as the AI going silent and a human typing). 'active'
        // → resume normal mode (operator resumed AI after takeover).
        const next = data.status as 'active' | 'handed_off' | 'ended'
        setConversationStatus(next)
        if (next === 'ended') {
          setMessages(m => [...m, {
            id: 'sys-ended-' + Date.now(),
            role: 'system',
            content: 'This chat has been closed by our team. Thanks for reaching out!',
          }])
          // Auto-prompt rating if the visitor hasn't already submitted one.
          // The CSAT modal de-dupes via setCsatStatus and a short
          // success-then-close timer (line 546).
          if (csatRating < 1) setCsatOpen(true)
        }
      }
    }

    const open = () => {
      if (cancelled) return
      clearBackoff()
      // Defense in depth: if a prior EventSource is still attached
      // (e.g. two reconnect signals raced), close it first so we don't
      // double-up on streams.
      if (esRef.current) {
        try { esRef.current.close() } catch {}
        esRef.current = null
      }
      const es = new EventSource(buildUrl())
      esRef.current = es

      es.onopen = () => {
        attempt = 0
        lastSeenAtRef.current = Date.now()
      }

      es.onmessage = (e) => {
        lastSeenAtRef.current = Date.now()
        if (e.lastEventId) lastEventIdRef.current = e.lastEventId
        try { handleEvent(JSON.parse(e.data)) } catch {}
      }

      es.onerror = () => {
        if (cancelled) return
        // Browser gave up after its own retries — take over with manual
        // exponential backoff so we don't sit dead. CONNECTING is left
        // alone; the browser is already auto-retrying and the visitor
        // doesn't need to know about a transient hiccup. Banner state
        // is driven by navigator.onLine, not by SSE state.
        if (es.readyState === EventSource.CLOSED) {
          esRef.current = null
          try { es.close() } catch {}
          const delay = BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)]
          attempt++
          backoffTimer = setTimeout(open, delay)
        }
      }
    }

    open()

    // Watchdog — catches silent TCP deaths (the server stopped sending
    // pings but the browser never noticed). Runs cheaply on a 5s tick.
    const watchdog = setInterval(() => {
      if (cancelled) return
      const idle = Date.now() - lastSeenAtRef.current
      const es = esRef.current
      if (es && idle > STALE_THRESHOLD_MS && es.readyState === EventSource.OPEN) {
        try { es.close() } catch {}
        esRef.current = null
        attempt = 0
        open()
      }
    }, 5000)

    // Force an immediate reconnect when the network or tab visibility
    // changes — way faster than waiting for the next backoff tick. The
    // online/offline events also drive the banner.
    const onOnline = () => {
      if (cancelled) return
      setNetworkOffline(false)
      attempt = 0
      const es = esRef.current
      if (!es || es.readyState === EventSource.CLOSED) {
        try { es?.close() } catch {}
        esRef.current = null
        clearBackoff()
        open()
      }
    }
    const onOffline = () => {
      if (cancelled) return
      setNetworkOffline(true)
    }
    const onVisible = () => {
      if (cancelled || document.visibilityState !== 'visible') return
      const idle = Date.now() - lastSeenAtRef.current
      const es = esRef.current
      if (idle > STALE_THRESHOLD_MS || !es || es.readyState !== EventSource.OPEN) {
        try { es?.close() } catch {}
        esRef.current = null
        clearBackoff()
        attempt = 0
        open()
      }
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearBackoff()
      clearInterval(watchdog)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      const es = esRef.current
      if (es) { try { es.close() } catch {} }
      esRef.current = null
    }
  }, [conversationId, widgetId, publicKey, reconnectNonce])

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
      if (data.visitorId) {
        setVisitorId(data.visitorId)
        setNeedsIdentity(false)
        if (data.recoveryEmailed) setRecoveryEmailed(true)
      } else setError(data.error || 'Failed to start chat')
    } finally { setSending(false) }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    const content = input.trim()
    if (!content || !conversationId || sending) return
    // Stop dictation the moment the visitor sends. Otherwise the
    // SpeechRecognition instance — started with continuous:true — keeps
    // listening with the mic indicator on, even though the input is now
    // empty. Reported as "the mic doesn't turn off."
    if (dictating) {
      try { dictationRef.current?.stop() } catch {}
      setDictating(false)
    }
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
    // Force the SSE effect to tear down + restart immediately, skipping
    // any in-flight backoff. The new connection still includes the
    // resume cursor so the visitor doesn't lose context.
    setReconnectNonce(n => n + 1)
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
    // h-screen, not min-h-screen — we need a constrained parent so the
    // messages-section's `flex-1 overflow-y-auto` actually scrolls
    // INTERNALLY. With min-h-screen the page grew with the transcript
    // and the entire page scrolled, taking the header + "you're chatting
    // with X · live" banner off-screen the moment you scrolled up.
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100">
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

      {/* Assignee banner — shown when an operator has taken the chat.
          Renders right under the header so the visitor knows they're
          on a live human, not the AI. Disappears if the operator hands
          it back to the queue. */}
      {assignedHuman && (
        <div className="px-4 py-2 border-b border-zinc-800 flex items-center gap-2.5"
          style={{ background: `linear-gradient(90deg, ${accent}1f, ${accent}0a)` }}>
          {assignedHuman.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={assignedHuman.image} alt="" className="w-6 h-6 rounded-full object-cover" />
          ) : (
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
              style={{ background: accent, color: '#fff' }}>
              {assignedHuman.name.charAt(0).toUpperCase()}
            </div>
          )}
          <p className="text-[11px] flex-1 min-w-0 truncate">
            <span className="font-semibold text-zinc-100">{assignedHuman.name}</span>
            <span className="text-zinc-400"> from the team is here to help</span>
          </p>
          <span className="text-[10px] text-emerald-300 font-medium inline-flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> live
          </span>
        </div>
      )}

      {/* Cross-device recovery prompt — we detected an existing chat
          tied to this email under a different cookie + sent a magic
          link. The visitor can keep chatting here OR click the link
          to pick up the old thread. */}
      {recoveryEmailed && (
        <div className="px-4 py-2 border-b text-[11px] flex items-center justify-between"
          style={{ background: 'rgba(245,158,11,0.10)', borderColor: 'rgba(245,158,11,0.30)', color: 'var(--accent-amber, #f59e0b)' }}>
          <span>We sent you a link to resume your previous chat. Check your email to pick up where you left off.</span>
          <button
            onClick={() => setRecoveryEmailed(false)}
            className="font-semibold ml-3 hover:text-white transition-colors"
            aria-label="Dismiss"
          >Got it</button>
        </div>
      )}

      {networkOffline && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-[11px] text-amber-300 flex items-center justify-between">
          <span>You&apos;re offline. Your messages will send once you&apos;re back online.</span>
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

          {/* Closure banner — shown when operator marked the chat
              resolved (status='ended'). Replaces the composer so the
              visitor doesn't try to send into a dead thread. Includes
              a way to start a new chat. */}
          {conversationStatus === 'ended' ? (
            <div className="p-4 border-t border-zinc-800 bg-zinc-900/40">
              <div className="rounded-lg border px-3 py-3 text-center"
                style={{ borderColor: ticketInfo ? accent : 'var(--border, #3f3f46)', background: 'var(--surface, #18181b)' }}>
                {ticketInfo ? (
                  <>
                    <p className="text-sm font-medium text-zinc-200 mb-1">
                      We&apos;ve created ticket <span className="font-mono">#{ticketInfo.number}</span>
                    </p>
                    <p className="text-[11px] text-zinc-400 mb-3">
                      We&apos;ll follow up via email at <span className="font-mono text-zinc-200">{ticketInfo.email}</span>.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-zinc-200 mb-1">This chat has ended</p>
                    <p className="text-[11px] text-zinc-500 mb-3">
                      Thanks for reaching out. Need more help?
                    </p>
                  </>
                )}
                <div className="flex gap-2 justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setCsatStatus(null)
                      setCsatOpen(true)
                    }}
                    className="text-[11px] font-medium px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                  >
                    Rate this chat
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // Start a new conversation — clear visitor's old
                      // conversation reference. The next visitor turn
                      // will POST /conversations and get a fresh row
                      // since the previous one is 'ended'.
                      setConversationId(null)
                      setConversationStatus('active')
                      setMessages([])
                    }}
                    className="text-[11px] font-medium px-3 py-1.5 rounded text-white transition-opacity hover:opacity-90"
                    style={{ background: accent }}
                  >
                    Start new chat
                  </button>
                </div>
              </div>
            </div>
          ) : (
          /* Composer */
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
          )}
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

/**
 * Format a Shopify money amount + ISO currency for display. Intl
 * handles symbol placement ($79.00, €79,00, ¥7900) and falls back to a
 * "CUR 79.00" form for unknown currency codes. Returns null when the
 * amount can't be parsed — caller hides the line in that case.
 */
function formatProductPrice(amount: string, currency: string): string | null {
  const n = Number(amount)
  if (!Number.isFinite(n)) return null
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n)
  } catch {
    return `${currency} ${amount}`
  }
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
  // Legible foreground for the visitor bubble (which takes the workspace's
  // brand colour as its background). Hardcoding text-white was unreadable
  // on dark/near-black brand colours; brandFg flips to black on light
  // accents and stays white on dark, per WCAG luminance.
  const visitorFg = buildBrandPalette(accent).brandFg

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

  // Product card — content is JSON { id, title, handle, price:{amount,currency}, imageUrl, url }.
  // Rendered as a tappable card so the visitor can jump straight to
  // the Shopify product page from the chat. Falls back to a plain
  // link if the JSON is malformed (shouldn't happen — we emit it
  // server-side from a typed adapter — but defensive against
  // hand-edited DB rows or future schema drift).
  if (msg.kind === 'product') {
    let card: { id: string; title: string; price: { amount: string; currency: string }; imageUrl: string | null; url: string } | null = null
    try { card = JSON.parse(msg.content) } catch {}
    if (card?.url) {
      const priceLabel = formatProductPrice(card.price.amount, card.price.currency)
      return (
        <div className={`flex ${isVisitor ? 'justify-end' : 'justify-start'}`}>
          <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-[80%] block rounded-2xl overflow-hidden border border-zinc-700 hover:border-zinc-500 transition-colors bg-zinc-900"
          >
            {card.imageUrl && (
              <div className="w-full bg-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={card.imageUrl} alt={card.title} className="block w-full h-auto max-h-48 object-cover" />
              </div>
            )}
            <div className="px-3 py-2.5 flex flex-col gap-1">
              <p className="text-sm font-medium text-zinc-100 leading-snug">{card.title}</p>
              {priceLabel && (
                <p className="text-sm font-semibold text-zinc-100">{priceLabel}</p>
              )}
              <span
                className="mt-2 inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: accent, color: visitorFg }}
              >
                View product
              </span>
            </div>
          </a>
        </div>
      )
    }
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
                ? 'rounded-tr-sm border-white/20'
                : 'rounded-tl-sm border-zinc-700 bg-zinc-800 text-zinc-100'
            }`}
            style={isVisitor ? { background: accent, color: visitorFg } : undefined}
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
          isVisitor ? 'rounded-tr-sm' : 'rounded-tl-sm bg-zinc-800 text-zinc-100'
        }`}
        style={isVisitor ? { background: accent, color: visitorFg } : undefined}
      >
        {msg.content}
      </div>
    </div>
  )
}
