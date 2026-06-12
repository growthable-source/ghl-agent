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
import { buildBrandPalette } from '@/lib/brand-theme'
import { playNotificationSound } from '@/lib/notification-sound'
import AISummarySection from './AISummarySection'
import UserInfoSection from './UserInfoSection'
import VisitorTimelineSection from './VisitorTimelineSection'
import CrmContextSection from './CrmContextSection'
import { relTime } from './conversation-helpers'

interface Message {
  id: string
  role: string
  content: string
  kind: string
  createdAt: string
  fromHuman?: boolean
  quickReplies?: string[]
  /** Detected ISO 639-1 language code. Null on legacy messages. */
  language?: string | null
  /** English translation for messages where language != 'en'. Rendered
   *  below the original in a muted style so monolingual operators can
   *  follow non-English chats. */
  translationEn?: string | null
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
  // Whitelabel brand the widget is tagged to. Null when the workspace
  // isn't running multi-brand or the widget hasn't been tagged. Comes
  // from widget.brand in the API response — we expose it on the top
  // level so the visitor panel doesn't have to reach into widget.*.
  brand?: { id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string | null } | null
  widget: { id: string; name: string; primaryColor: string; agencyUrl?: string | null; brand?: { id: string; name: string; slug: string; logoUrl: string | null; primaryColor: string | null } | null }
  // Page the visitor was on when they first opened this chat. Frozen
  // at create-time. Distinct from the visitor's currentUrl in the
  // timeline (which keeps moving as they browse).
  initiatedUrl?: string | null
  initiatedTitle?: string | null
  // Set when this thread was merged INTO another — we point the operator
  // at the survivor instead of showing the now-emptied husk.
  mergedIntoId?: string | null
  visitor: { id: string; name: string | null; email: string | null; phone?: string | null; firstSeenAt: string; lastSeenAt?: string; crmContactId?: string | null }
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

// Compact, human-readable URL for the inbox side panel — drop the
// protocol + trailing slash, keep host + path so a rep can tell which
// page/brand a chat came from at a glance. Falls back to the raw string
// if it isn't a parseable URL.
function prettyUrl(raw: string): string {
  try {
    const u = new URL(raw)
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
    return (u.host + path).replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/\/$/, '')
  }
}

// Conversations recorded before the purl fix have OUR embed iframe URL
// stored as their origin ("…/widget/<id>/embed?pk=widget_pub_…") — the
// embed page used to fall back to its own window.location when the
// parent didn't pass one. Showing that to an operator is worse than
// showing nothing, so the panel treats those rows as having no origin.
function isInternalEmbedUrl(raw: string): boolean {
  return /\/widget\/[^/]+\/(embed|call|live)\b/.test(raw) || raw.includes('pk=widget_pub_')
}

// ISO 639-1 → human-readable label for the translation badge.
// Covers the languages the detector accepts; falls back to the raw
// code for anything else.
const LANG_LABEL: Record<string, string> = {
  es: 'ES', fr: 'FR', de: 'DE', it: 'IT', pt: 'PT', nl: 'NL', sv: 'SV',
  no: 'NO', da: 'DA', fi: 'FI', pl: 'PL', ru: 'RU', uk: 'UK', tr: 'TR',
  ar: 'AR', he: 'HE', fa: 'FA', hi: 'HI', bn: 'BN', ja: 'JA', ko: 'KO',
  zh: 'ZH', vi: 'VI', th: 'TH', id: 'ID', ms: 'MS', tl: 'TL', el: 'EL',
  cs: 'CS', hu: 'HU', ro: 'RO', bg: 'BG', hr: 'HR', sr: 'SR', sk: 'SK',
  sl: 'SL', et: 'ET', lv: 'LV', lt: 'LT',
}
function languageLabel(code: string): string {
  return LANG_LABEL[code] ?? code.toUpperCase()
}
// relTime moved to ./conversation-helpers (imported above).

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
  // The "live updates paused" banner is gated on the BROWSER's
  // navigator.onLine, not on SSE reconnect latency. The same fix as the
  // visitor widget — calling slow Vercel cold-start reconnects "offline"
  // flashed the banner on every routine cycle. SSE reconnect machinery
  // (backoff, watchdog, Last-Event-ID resume) still runs underneath.
  const [networkOffline, setNetworkOffline] = useState(false)
  const [reconnectNonce, setReconnectNonce] = useState(0)
  const lastEventIdRef = useRef<string | null>(null)
  const lastSeenAtRef = useRef<number>(Date.now())
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  // How many of the trailing messages to render. Long threads (50+)
  // pushed the composer below the fold and made the page feel
  // overwhelming, so we render the last N and let the operator
  // "Load older" in batches. Each click roughly doubles the window.
  const INITIAL_MESSAGE_WINDOW = 7
  const [messageWindow, setMessageWindow] = useState<number>(INITIAL_MESSAGE_WINDOW)

  // Ticketing — populated by a small probe on mount when ticketing is
  // active. Shows either a "View ticket #N" pill or a "Promote to
  // ticket" button next to the assignee dropdown. Stays hidden when
  // ticketing isn't active for the workspace.
  const [ticketingActive, setTicketingActive] = useState<boolean>(false)
  const [linkedTicket, setLinkedTicket] = useState<{ id: string; ticketNumber: number } | null>(null)
  const [promoting, setPromoting] = useState(false)

  // Merge — pull another (often abandoned) thread from the same visitor
  // into this one so a returning customer's split history reads as one
  // conversation. Candidates load lazily when the dropdown opens.
  const [mergeOpen, setMergeOpen] = useState(false)
  const [mergeLoading, setMergeLoading] = useState(false)
  const [merging, setMerging] = useState(false)
  const [mergeCandidates, setMergeCandidates] = useState<Array<{
    id: string; status: string; createdAt: string; lastMessageAt: string; messageCount: number; preview: string
  }>>([])
  useEffect(() => {
    let cancelled = false
    fetch(`/api/workspaces/${workspaceId}/settings/ticketing`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setTicketingActive(!!d?.status?.active) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId])

  async function promoteToTicket() {
    if (!convo) return
    if (!convo.visitor.email) {
      alert('This visitor has no email. Tickets need an email address to follow up over.')
      return
    }
    setPromoting(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tickets/promote-from-conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Promote failed.'); return }
      setLinkedTicket({ id: data.ticket.id, ticketNumber: data.ticket.ticketNumber })
    } finally { setPromoting(false) }
  }

  async function toggleMerge() {
    const next = !mergeOpen
    setMergeOpen(next)
    if (!next) return
    setMergeLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/merge`)
      const data = await res.json()
      setMergeCandidates(Array.isArray(data.candidates) ? data.candidates : [])
    } catch {
      setMergeCandidates([])
    } finally { setMergeLoading(false) }
  }

  async function mergeIn(sourceId: string) {
    if (merging) return
    if (!confirm('Merge that conversation into this one? Its messages move here and it gets marked ended. This can’t be undone.')) return
    setMerging(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceConversationId: sourceId }),
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Merge failed.'); return }
      setMergeOpen(false)
      await fetchConvo()
    } finally { setMerging(false) }
  }

  const scrollRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const typingPingTimer = useRef<any>(null)
  const lastTypingPing = useRef(0)

  const fetchConvo = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/messages`)
    const data = await res.json()
    if (data.conversation) {
      setConvo(data.conversation)
      // Seed the ticket pill from the convo payload — saves an extra
      // round-trip and matches what the user sees server-side.
      if (data.conversation.ticket) {
        setLinkedTicket({ id: data.conversation.ticket.id, ticketNumber: data.conversation.ticket.ticketNumber })
      } else {
        setLinkedTicket(null)
      }
    }
    setLoading(false)
  }, [workspaceId, conversationId])

  useEffect(() => { fetchConvo() }, [fetchConvo])

  // Reset the trailing-message window whenever the operator switches
  // to a different conversation. Without this, a long thread would
  // stay expanded forever once "Load older" had been clicked.
  useEffect(() => {
    setMessageWindow(INITIAL_MESSAGE_WINDOW)
  }, [conversationId])

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

  // SSE: live subscription so the operator sees every visitor/agent
  // turn the moment it happens. Same connection state machine the
  // visitor widget uses — silent during the routine maxDuration
  // cycle, banner only when truly offline. See the embed page for the
  // full rationale.
  useEffect(() => {
    if (!conversationId) return

    const STALE_THRESHOLD_MS = 35000
    const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 10000, 30000]
    let backoffTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    const buildUrl = () => {
      const base = `/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/stream`
      const since = lastEventIdRef.current
      return since ? `${base}?since=${encodeURIComponent(since)}` : base
    }
    const clearBackoff = () => { if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null } }

    if (typeof navigator !== 'undefined') setNetworkOffline(!navigator.onLine)
    let attempt = 0

    const handleEvent = (data: any) => {
      if (data.type === 'ping') return
      if (data.type === 'hello' || data.type === 'resume_truncated') return
      if (data.type === 'agent_message') {
        setConvo(c => c ? { ...c, messages: appendOrReplace(c.messages, {
          id: data.id, role: 'agent', content: data.content, kind: data.kind || 'text',
          createdAt: data.createdAt, fromHuman: !!data.fromHuman, quickReplies: data.quickReplies,
        }) } : c)
        setAgentTyping({ active: false, fromHuman: false })
      } else if (data.type === 'visitor_message') {
        // Operator audio cue — only the visitor side fires here.
        // Operator-sent messages come back as `agent_message` events
        // (role=agent fromHuman=true); those don't ping because the
        // operator already knows what they just sent.
        playNotificationSound('inbox')
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
      } else if (data.type === 'translation_update') {
        // Background translator finished — patch the message in place
        // so the operator sees the English version slide in under
        // the original. id matches the WidgetMessage row.
        setConvo(c => {
          if (!c) return c
          return {
            ...c,
            messages: c.messages.map(m =>
              m.id === data.id
                ? { ...m, language: data.language, translationEn: data.translationEn }
                : m,
            ),
          }
        })
      }
    }

    const open = () => {
      if (cancelled) return
      clearBackoff()
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
  }, [workspaceId, conversationId, reconnectNonce])

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
  // Origin link for the side panel — drop legacy rows that recorded our
  // own embed iframe URL instead of the customer's page.
  const originUrl = convo.initiatedUrl && !isInternalEmbedUrl(convo.initiatedUrl) ? convo.initiatedUrl : null
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
    // h-full + min-h-0 throughout: without an explicit height the flex
    // children grow to fit their content, which pushed the composer below
    // the fold so operators had to scroll the whole pane to reach the
    // reply box. Constraining height here lets the message list be the
    // only thing that scrolls, pinning the composer to the bottom.
    <div className="flex-1 flex overflow-hidden h-full min-h-0">
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
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
            {/* Ticketing pill — "View ticket #N" when linked, "Promote
                to ticket" otherwise. Only renders when ticketing is
                active on the workspace (plan + toggle). */}
            {ticketingActive && (linkedTicket ? (
              <Link
                href={`/dashboard/${workspaceId}/tickets/${linkedTicket.id}`}
                className="text-[10px] font-medium px-2 py-1 rounded-full bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 transition-colors"
              >
                🎫 Ticket #{linkedTicket.ticketNumber}
              </Link>
            ) : convo.visitor.email ? (
              <button
                onClick={promoteToTicket}
                disabled={promoting}
                className="text-[10px] font-medium px-2 py-1 rounded-full border border-dashed border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50"
                title="Promote this chat to an email-based ticket"
              >
                {promoting ? '…' : '🎫 Promote to ticket'}
              </button>
            ) : (
              <span
                className="text-[10px] px-2 py-1 rounded-full border border-dashed border-zinc-800 text-zinc-600"
                title="The visitor needs an email before this can become a ticket."
              >
                🎫 needs email
              </span>
            ))}
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

            {/* Merge — fold another thread from this visitor into the
                current one. Hidden once the chat is ended (merge target
                should be the live thread). */}
            {!isEnded && (
              <div className="relative">
                <button
                  type="button"
                  onClick={toggleMerge}
                  disabled={merging}
                  className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-40"
                  title="Combine another conversation from this visitor into this one"
                >
                  ⤵ Merge
                </button>
                {mergeOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMergeOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 w-72 max-h-80 overflow-y-auto bg-zinc-950 border border-zinc-700 rounded-lg shadow-xl">
                      <div className="px-3 py-2 border-b border-zinc-800 sticky top-0 bg-zinc-950">
                        <p className="text-[11px] font-semibold text-zinc-200">Merge a chat into this one</p>
                        <p className="text-[10px] text-zinc-500">Its messages move here; it’s marked ended.</p>
                      </div>
                      {mergeLoading ? (
                        <div className="px-3 py-3 text-xs text-zinc-500">Loading…</div>
                      ) : mergeCandidates.length === 0 ? (
                        <div className="px-3 py-3 text-xs text-zinc-500">No other conversations from this visitor to merge.</div>
                      ) : (
                        mergeCandidates.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => mergeIn(c.id)}
                            disabled={merging}
                            className="w-full text-left px-3 py-2 hover:bg-zinc-900 border-b border-zinc-900 last:border-0 disabled:opacity-50"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] text-zinc-300 truncate">{c.preview}</span>
                              <span className="text-[9px] text-zinc-600 whitespace-nowrap">{relTime(c.lastMessageAt)}</span>
                            </div>
                            <p className="text-[10px] text-zinc-600 mt-0.5">
                              {c.messageCount} msg{c.messageCount === 1 ? '' : 's'} · {c.status === 'ended' ? 'ended' : c.status === 'handed_off' ? 'taken over' : 'active'}
                            </p>
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Resume AI: only visible when the operator has taken
                over (status=handed_off). Flips status back to 'active'
                so the agent runner stops gating on the takeover and
                the AI handles the next inbound message. Without this
                button operators were stuck — once they jumped in there
                was no way to hand back to the AI short of marking the
                conversation ended (which wipes the thread). */}
            {isHandedOff && (
              <button
                onClick={() => setStatus('active')}
                disabled={statusBusy}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40"
                style={{ borderColor: 'var(--accent-emerald)', color: 'var(--accent-emerald)' }}
                title="Hand control back to the AI agent. Next visitor message will be handled by the AI again."
              >
                ↺ Resume AI
              </button>
            )}
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

        {convo.mergedIntoId && (
          <div className="px-6 py-2 bg-zinc-800/60 border-b border-zinc-700 text-[11px] text-zinc-300 flex items-center justify-between">
            <span>This chat was merged into another conversation.</span>
            <Link
              href={`/dashboard/${workspaceId}/inbox?conversation=${convo.mergedIntoId}`}
              className="font-semibold text-orange-400 hover:text-orange-300 transition-colors"
            >
              Open merged thread →
            </Link>
          </div>
        )}

        {networkOffline && (
          <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/30 text-[11px] text-amber-300 flex items-center justify-between">
            <span>Live updates paused — you appear to be offline.</span>
            <button
              onClick={() => setReconnectNonce(n => n + 1)}
              className="font-semibold text-amber-200 hover:text-white transition-colors"
            >Retry now</button>
          </div>
        )}

        {/* Messages — long threads collapsed to the trailing window.
            "Load older" reveals the earlier ones in batches. The hidden
            indexes still map to the same MessageBubble + lastAgentIdx
            indices so quick replies and other index-dependent behaviour
            keeps working. */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-6 space-y-3">
          {(() => {
            const total = convo.messages.length
            const visibleStart = Math.max(0, total - messageWindow)
            const hiddenCount = visibleStart
            return (
              <>
                {hiddenCount > 0 && (
                  <div className="flex justify-center">
                    <button
                      onClick={() => setMessageWindow(w => Math.min(total, w + 20))}
                      className="text-xs font-medium px-3 py-1.5 rounded-full border transition-colors hover:bg-zinc-900/40"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                    >
                      ↑ Load older messages ({hiddenCount})
                    </button>
                  </div>
                )}
                {convo.messages.slice(visibleStart).map((m, idxInWindow) => {
                  const absoluteIdx = visibleStart + idxInWindow
                  return (
                    <MessageBubble
                      key={m.id}
                      msg={m}
                      accent={accent}
                      showQuickReplies={absoluteIdx === lastAgentIdx && !!m.quickReplies?.length}
                    />
                  )
                })}
              </>
            )
          })()}
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
          <div className="p-4 border-t flex-shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="max-w-3xl mx-auto">
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>
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
                  className="w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-30"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                  </svg>
                </button>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setEmojiOpen(o => !o)}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                    style={{ color: 'var(--text-tertiary)' }}
                    title="Emoji"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  {emojiOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setEmojiOpen(false)} />
                      <div
                        className="absolute bottom-11 left-0 z-40 rounded-lg p-2 shadow-xl grid grid-cols-8 gap-1 w-[260px]"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border-secondary)' }}
                      >
                        {EMOJI_GRID.map(e => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => { setReply(prev => prev + e); setEmojiOpen(false) }}
                            className="text-lg w-8 h-8 rounded transition-colors hover:bg-zinc-800"
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
                  className="flex-1 resize-none rounded-lg px-3 py-2 text-sm focus:outline-none max-h-32"
                  style={{
                    background: 'var(--input-bg)',
                    color: 'var(--input-text)',
                    border: '1px solid var(--input-border)',
                  }}
                />
                <button
                  onClick={send}
                  disabled={!reply.trim() || sending}
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
                  style={
                    !reply.trim() || sending
                      ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }
                      : { background: accent, color: '#fff' }
                  }
                >
                  {sending ? '…' : 'Send'}
                </button>
              </div>
              {uploading && <p className="text-[11px] mt-2" style={{ color: 'var(--text-tertiary)' }}>Uploading…</p>}
            </div>
          </div>
        ) : (
          <div
            className="p-4 border-t flex-shrink-0 text-center text-xs"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-tertiary)' }}
          >
            This conversation is closed. Click{' '}
            <button
              onClick={() => setStatus('active')}
              className="underline transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              Reopen
            </button>
            {' '}to follow up.
          </div>
        )}
      </div>

      {/* Right sidebar */}
      <aside className="w-80 border-l border-zinc-800 overflow-y-auto bg-zinc-950 hidden lg:block">
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

          {/* Brand chip — only renders when the widget is tagged. Lets
              the operator confirm at a glance which client/brand the
              chat is for without having to scroll back to the inbox row. */}
          {convo.widget?.brand && (
            <div className="mt-4 flex items-center gap-2 p-2 rounded-lg bg-zinc-900 border border-zinc-800">
              {convo.widget.brand.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={convo.widget.brand.logoUrl} alt="" className="w-6 h-6 rounded object-cover flex-shrink-0" />
              ) : (
                <span
                  className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-semibold text-white flex-shrink-0"
                  style={{ background: convo.widget.brand.primaryColor || accent }}
                >
                  {convo.widget.brand.name.charAt(0).toUpperCase()}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Brand</p>
                <p className="text-xs text-zinc-100 truncate">{convo.widget.brand.name}</p>
              </div>
            </div>
          )}

          {/* "Started chat on" intentionally removed from this header
              block — it duplicated the first page_view event in the
              timeline below and operators kept reading it as "the URL
              where the widget is embedded" rather than "where the
              visitor was when they opened the chat." The page-path
              section in VisitorTimelineSection now leads with
              "Currently on" and lists the visit history. */}

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

          {/* Origin + quick links. "Came from" is the page the visitor
              actually opened the chat on (their site), so a rep working
              many whitelabel brands can tell at a glance which client
              this is. "Client site" is the operator-set agency URL — a
              one-click shortcut to the brand's dashboard/site. Either
              renders only when present. */}
          {(originUrl || convo.widget?.agencyUrl) && (
            <div className="mt-3 space-y-2">
              {originUrl && (
                <a
                  href={originUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors group"
                  title={originUrl}
                >
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Came from ↗</p>
                  <p className="text-xs text-zinc-200 truncate font-mono group-hover:text-white">{prettyUrl(originUrl)}</p>
                  {convo.initiatedTitle && (
                    <p className="text-[10px] text-zinc-500 truncate mt-0.5">{convo.initiatedTitle}</p>
                  )}
                </a>
              )}
              {convo.widget?.agencyUrl && (
                <a
                  href={convo.widget.agencyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 p-2.5 rounded-lg border border-dashed border-zinc-700 hover:border-orange-500/60 transition-colors group"
                  title={convo.widget.agencyUrl}
                >
                  <span className="text-sm">🔗</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Client site</p>
                    <p className="text-xs text-orange-400 truncate group-hover:text-orange-300">{prettyUrl(convo.widget.agencyUrl)}</p>
                  </div>
                </a>
              )}
            </div>
          )}
        </div>

        {/* Operator-editable name / email / phone for the visitor.
            Saving creates/updates a NativeContact record for native
            CRM workspaces; for external-CRM workspaces it just
            updates the WidgetVisitor and the existing GHL bridge
            picks up the change on next sync. */}
        <UserInfoSection
          workspaceId={workspaceId}
          conversationId={conversationId}
          visitor={convo.visitor}
          onSaved={fetchConvo}
        />

        {/* Haiku-generated quick summary. Cached on the conversation;
            "Refresh" forces a regenerate. Operators scanning a busy
            inbox can get the gist without reading the full transcript. */}
        <AISummarySection workspaceId={workspaceId} conversationId={conversationId} />

        {/* Export menu — download THIS single conversation in the
            operator's chosen format. Bulk export lives on the inbox
            page header. */}
        <div className="p-5 border-b border-zinc-800">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">Export</p>
          <div className="flex gap-2">
            {(['md', 'csv', 'json'] as const).map(fmt => (
              <a
                key={fmt}
                href={`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/export?format=${fmt}`}
                className="text-[11px] font-semibold px-2.5 py-1 rounded border border-zinc-700 hover:border-zinc-500 text-zinc-300 hover:text-white transition-colors"
              >
                .{fmt}
              </a>
            ))}
          </div>
        </div>

        {/* Where they are now + activity stream — pulled from the
            visitor-events API. Renders nothing for visitors who
            haven't fired any events yet. */}
        <VisitorTimelineSection workspaceId={workspaceId} conversationId={conversationId} />

        {/* CRM context — only renders when the visitor is tied to a
            real CRM contact. Quietly hidden otherwise. */}
        <CrmContextSection workspaceId={workspaceId} conversationId={conversationId} />

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
  // Pick a legible foreground for the agent bubble based on the
  // workspace's brand colour. Hardcoded `text-white` was unreadable on
  // dark/near-black brand colours; brandFg flips to black on light
  // backgrounds and stays white on dark ones, per WCAG luminance.
  const agentFg = buildBrandPalette(accent).brandFg

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
                : 'rounded-tr-sm border-white/20'
            }`}
            style={!isVisitor ? { background: accent, color: agentFg } : undefined}
          >
            <span className="text-base leading-none">📎</span>
            <span className="truncate">{meta.name}</span>
          </a>
        </div>
      )
    }
  }

  // Non-English message: render the English translation underneath
  // in a smaller, muted bubble so operators can read what the AI
  // said in Spanish/French/Portuguese/etc. The translation is also
  // marked with the source language for context.
  const showTranslation = msg.language && msg.language !== 'en' && !!msg.translationEn

  return (
    <div className={`flex ${isVisitor ? 'justify-start' : 'justify-end'}`}>
      <div className="max-w-[70%]">
        <div
          className={`px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
            isVisitor ? 'rounded-tl-sm bg-zinc-800 text-zinc-100' : 'rounded-tr-sm'
          }`}
          style={!isVisitor ? { background: accent, color: agentFg } : undefined}
        >
          {msg.content}
        </div>
        {showTranslation && (
          <div className={`mt-1.5 ${isVisitor ? 'pl-3' : 'pr-3'}`}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-[9px] uppercase font-semibold tracking-wider px-1 py-0.5 rounded"
                style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
                {languageLabel(msg.language!)} → EN
              </span>
            </div>
            <p className="text-[12px] italic leading-snug whitespace-pre-wrap"
              style={{ color: 'var(--text-tertiary)' }}>
              {msg.translationEn}
            </p>
          </div>
        )}
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

