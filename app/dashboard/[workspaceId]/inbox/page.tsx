'use client'

import { useEffect, useMemo, useState, useCallback, useRef, Fragment, type ReactNode } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import InboxConversationPanel from '@/components/inbox/InboxConversationPanel'
import { isNotificationSoundMuted, setNotificationSoundMuted, playNotificationSound, getNotificationVolume, setNotificationVolume } from '@/lib/notification-sound'
import { useBackgroundPolling } from '@/lib/use-background-polling'

interface AssignedUser {
  id: string
  name: string | null
  email: string | null
  image?: string | null
}

interface Brand {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
  primaryColor?: string | null
}

interface BrandGroup {
  id: string
  name: string
  priority: number
  color: string | null
}

interface Row {
  id: string
  // 'widget' = website chat, 'meta' = Facebook Messenger or Instagram DM.
  // Drives the channel pill icon and (in the detail page) which API
  // path to fetch for messages + replies.
  source?: 'widget' | 'meta'
  channel?: 'widget' | 'messenger' | 'instagram'
  widget: { id: string; name: string; primaryColor?: string }
  brand: Brand | null
  brandGroup?: BrandGroup | null
  visitor: { id: string; name: string | null; email: string | null; cookieId: string; avatarUrl?: string | null }
  status: string
  messageCount: number
  csatRating: number | null
  assignedUserId: string | null
  assignedUser: AssignedUser | null
  assignedAt: string | null
  assignmentReason: string | null
  lastMessageAt: string
  lastMessage: { role: string; content: string; kind?: string; createdAt: string } | null
  // Search-only metadata. Populated by the /search endpoint when
  // there's a query — empty when the inbox is showing the regular
  // recency list.
  matchedIn?: Array<'visitor' | 'message' | 'assignee' | 'widget' | 'brand' | 'csat'>
  snippets?: string[]
}

// Mockup-faithful filter buckets: All / Unread / Needs human / AI handled.
// Maps onto the existing data shape — see the counts useMemo for the
// exact predicates. The "ended" status doesn't get a chip in the new
// IA; it's accessible via the brand picker / search if needed.
type StatusTab = 'all' | 'unread' | 'needs_human' | 'ai_handled'
type AssignTab = 'all' | 'mine' | 'unassigned'
// CSAT filter — 'any' = no filter, 'rated' = any 1-5 rating, '1'..'5'
// = exact star count, 'unrated' = closed/handed-off chats with no
// rating recorded. Kept as strings so it round-trips a URL param
// cleanly if we later want to deep-link.
type RatingFilter = 'any' | 'rated' | '1' | '2' | '3' | '4' | '5' | 'unrated'

function isUnreadRow(r: { status: string; lastMessage?: { role: string } | null }): boolean {
  return r.lastMessage?.role === 'visitor' && r.status !== 'ended'
}
function isAiHandledRow(r: { status: string; lastMessage?: { role: string } | null }): boolean {
  return r.lastMessage?.role === 'agent' && r.status === 'active'
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function isHot(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 5 * 60 * 1000
}

function initialOf(name: string | null | undefined, email: string | null | undefined, fallback = '?'): string {
  return ((name || email || fallback).charAt(0) || fallback).toUpperCase()
}

export default function InboxPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const [rows, setRows] = useState<Row[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [tab, setTab] = useState<StatusTab>('all')
  const [assignTab, setAssignTab] = useState<AssignTab>('all')
  // CSAT rating filter — applied client-side from the csatRating
  // already on each row. Default 'any' = no filter so the inbox
  // behaves exactly as before unless the operator explicitly narrows.
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>('any')
  // Filter to a specific assigned operator. `null` = no assignee filter
  // (mirrors 'all'). The drop-down is populated from /members so we can
  // show name + avatar in each option.
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null)
  const [members, setMembers] = useState<Array<{ id: string; user: { id: string; name: string | null; email: string | null; image: string | null } }>>([])
  const [search, setSearch] = useState('')
  const [meId, setMeId] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState<boolean>(true)
  // Assignment-sound detection. We diff each feed refresh against the
  // previous assignee map; when a conversation flips to "mine" that
  // wasn't before, a distinct assignment ping fires. Refs (not state)
  // so fetchRows doesn't need meId in its deps and re-subscribe.
  const meIdRef = useRef<string | null>(null)
  const prevAssignedRef = useRef<Map<string, string | null>>(new Map())
  const assignSeededRef = useRef(false)
  // Bulk select + close (widget conversations only — Meta rows aren't
  // closable through the widget bulk endpoint).
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkClosing, setBulkClosing] = useState(false)
  // Brand filter — value is the brand *slug*. 'all' = no filter,
  // 'untagged' = conversations on widgets that aren't tagged to any
  // brand. Initial value comes from ?brand=<slug> on the URL so the
  // brands page can deep-link straight into the brand-scoped inbox.
  const [brandSlug, setBrandSlug] = useState<string>(searchParams.get('brand') || 'all')
  const [brandPickerOpen, setBrandPickerOpen] = useState(false)
  const [brandSearch, setBrandSearch] = useState('')
  // Selected conversation for the right-pane detail. URL-synced via
  // ?conversation=<id> so deep-links and back-button navigation work.
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('conversation'))

  // Per-conversation "last opened by this operator" timestamps, used
  // to drive the unread (bold) treatment. Persisted in localStorage
  // so reload / closing the browser doesn't clear unread state. Map
  // shape: conversationId → ms epoch of last open. Missing = never
  // opened.
  //
  // We replicate to React state because localStorage changes don't
  // trigger re-render on their own; this state is the render source
  // of truth and localStorage is the persistence shadow.
  const [readAtMap, setReadAtMap] = useState<Record<string, number>>({})
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const out: Record<string, number> = {}
      const prefix = `inbox-opened-${workspaceId}-`
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (!k || !k.startsWith(prefix)) continue
        const v = localStorage.getItem(k)
        if (!v) continue
        out[k.slice(prefix.length)] = parseInt(v, 10) || 0
      }
      setReadAtMap(out)
    } catch { /* localStorage disabled — every row stays unread, mild ergonomics hit */ }
  }, [workspaceId])

  function markConversationOpened(conversationId: string) {
    const now = Date.now()
    setReadAtMap(prev => ({ ...prev, [conversationId]: now }))
    try { localStorage.setItem(`inbox-opened-${workspaceId}-${conversationId}`, String(now)) } catch {}
  }

  // Mark-as-read whenever a conversation becomes selected — this fires
  // for both the embedded row-click path AND the deep-link / URL-param
  // path. Without this effect, deep-linking to /inbox?conversation=X
  // would leave the row's unread bold treatment in place until the
  // operator manually clicked it.
  useEffect(() => {
    if (selectedId) markConversationOpened(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, workspaceId])

  // Two fetch modes:
  //   1) No query, no brand filter → cheap list endpoint, polled every 8s.
  //   2) Query OR a non-default brand filter → server-backed search
  //      that walks transcripts + metadata. Debounced via the effect
  //      that triggers it; not polled (search results don't need to
  //      auto-refresh while you're scoping a historical lookup).
  const usingSearch = search.trim().length > 0 || (brandSlug !== 'all')
  const fetchRows = useCallback(async () => {
    if (usingSearch) {
      const url = new URL(`/api/workspaces/${workspaceId}/widget-conversations/search`, window.location.origin)
      if (search.trim()) url.searchParams.set('q', search.trim())
      if (brandSlug !== 'all') url.searchParams.set('brand', brandSlug)
      const res = await fetch(url.pathname + url.search)
      const data = await res.json()
      setRows(data.conversations || [])
      setNotMigrated(!!data.notMigrated)
      setLoading(false)
      return
    }
    // Unified inbox feed: widget conversations + Meta (Messenger / IG)
    // conversations sorted by recency. Meta rows synthesize widget +
    // visitor fields so the existing list renderer Just Works; the
    // `source` / `channel` fields on each row drive the channel pill.
    const res = await fetch(`/api/workspaces/${workspaceId}/inbox`)
    const data = await res.json()
    const newRows: Row[] = data.conversations || []

    // Assignment ping: when a chat flips to "assigned to me" since the
    // last refresh, play the distinct assignment sound. Seeded on the
    // first load so existing assignments don't all ping at once.
    const me = meIdRef.current
    const prev = prevAssignedRef.current
    if (assignSeededRef.current && me) {
      for (const r of newRows) {
        if (r.assignedUserId === me && prev.get(r.id) !== me) {
          playNotificationSound('inbox', { variant: 'assignment' })
          break
        }
      }
    }
    const nextMap = new Map<string, string | null>()
    for (const r of newRows) nextMap.set(r.id, r.assignedUserId)
    prevAssignedRef.current = nextMap
    assignSeededRef.current = true

    setRows(newRows)
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId, usingSearch, search, brandSlug])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const exitSelectMode = useCallback(() => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }, [])

  const bulkClose = useCallback(async () => {
    if (selectedIds.size === 0) return
    setBulkClosing(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/widget-conversations/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds), status: 'ended' }),
      })
      await fetchRows()
      exitSelectMode()
    } finally {
      setBulkClosing(false)
    }
  }, [workspaceId, selectedIds, fetchRows, exitSelectMode])

  // Bootstrap: load current user + presence flag + brands in parallel.
  useEffect(() => {
    ;(async () => {
      try {
        const [meRes, presenceRes, brandsRes, membersRes] = await Promise.all([
          fetch('/api/me'),
          fetch(`/api/workspaces/${workspaceId}/me/presence`),
          fetch(`/api/workspaces/${workspaceId}/brands`),
          fetch(`/api/workspaces/${workspaceId}/members`),
        ])
        const me = await meRes.json()
        const p = await presenceRes.json()
        const b = await brandsRes.json()
        const mem = await membersRes.json()
        if (me?.user?.id) { setMeId(me.user.id); meIdRef.current = me.user.id }
        if (typeof p?.isAvailable === 'boolean') setIsAvailable(p.isAvailable)
        if (Array.isArray(b?.brands)) setBrands(b.brands)
        if (Array.isArray(mem?.members)) setMembers(mem.members)
      } catch { /* fail-open: keep defaults */ }
    })()
  }, [workspaceId])

  // Keep ?brand=<slug> + ?conversation=<id> in sync with state so
  // deep-links and back-button navigation behave naturally.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (brandSlug === 'all') url.searchParams.delete('brand')
    else url.searchParams.set('brand', brandSlug)
    if (selectedId) url.searchParams.set('conversation', selectedId)
    else url.searchParams.delete('conversation')
    router.replace(url.pathname + url.search, { scroll: false })
  }, [brandSlug, selectedId, router])

  // Initial fetch + refetch when filters change. For the live recency
  // list (no query, no brand), poll every 8 seconds so new
  // conversations stream in. For the search view, debounce 250ms to
  // avoid hammering the server on every keystroke and don't poll —
  // the search is an explicit user action, not ambient.
  useEffect(() => {
    if (usingSearch) {
      const t = setTimeout(() => { fetchRows() }, 250)
      return () => clearTimeout(t)
    }
    fetchRows()
  }, [fetchRows, usingSearch])
  // Visibility-aware: stops in backgrounded tabs, refreshes on return.
  useBackgroundPolling(fetchRows, 8000, !usingSearch)

  async function togglePresence() {
    const next = !isAvailable
    setIsAvailable(next)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/me/presence`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: next }),
      })
      if (!res.ok) setIsAvailable(!next)
    } catch {
      setIsAvailable(!next)
    }
  }

  const counts = useMemo(() => {
    const unread = rows.filter(isUnreadRow).length
    const needs_human = rows.filter(r => r.status === 'handed_off').length
    const ai_handled = rows.filter(isAiHandledRow).length
    const mine = meId ? rows.filter(r => r.assignedUserId === meId).length : 0
    const unassigned = rows.filter(r => !r.assignedUserId).length
    return { all: rows.length, unread, needs_human, ai_handled, mine, unassigned }
  }, [rows, meId])

  const filtered = useMemo(() => {
    let f = rows
    if (tab === 'unread') f = f.filter(isUnreadRow)
    else if (tab === 'needs_human') f = f.filter(r => r.status === 'handed_off')
    else if (tab === 'ai_handled') f = f.filter(isAiHandledRow)

    if (assignTab === 'mine' && meId) f = f.filter(r => r.assignedUserId === meId)
    else if (assignTab === 'unassigned') f = f.filter(r => !r.assignedUserId)

    if (ratingFilter !== 'any') {
      if (ratingFilter === 'rated') f = f.filter(r => typeof r.csatRating === 'number')
      else if (ratingFilter === 'unrated') f = f.filter(r => r.csatRating === null || r.csatRating === undefined)
      else f = f.filter(r => r.csatRating === Number(ratingFilter))
    }

    if (assigneeFilter) {
      f = f.filter(r => r.assignedUserId === assigneeFilter)
    }

    // When `usingSearch` is true the server already applied brand +
    // free-text filters. The status / assignment / rating tabs are
    // still client-side because they're cheap to flip and don't
    // change the underlying result set semantically — operators
    // expect them to narrow what's already on screen.

    // Two-tier sort: active chats first (anything not 'ended'),
    // then ended chats at the bottom. Within each tier we keep the
    // server's lastMessageAt desc order. Renderer drops a "Closed"
    // divider between the two groups.
    const statusRank = (s: string) => (s === 'ended' ? 1 : 0)
    f = [...f].sort((a, b) => {
      const sa = statusRank(a.status), sb = statusRank(b.status)
      if (sa !== sb) return sa - sb
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    })
    return f
  }, [rows, tab, assignTab, ratingFilter, assigneeFilter, meId])

  // Index of the first 'ended' row in the sorted list — used to drop
  // a "Closed" divider before it. -1 if there are no ended chats or
  // every chat is ended.
  const firstClosedIdx = useMemo(() => {
    if (filtered.length === 0) return -1
    const idx = filtered.findIndex(r => r.status === 'ended')
    if (idx === 0) return -1   // every row is ended; no divider needed at the top
    return idx
  }, [filtered])

  if (loading) return (
    <div className="flex-1 p-8">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
        <div className="h-16 rounded-xl border animate-pulse" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }} />
        <div className="h-16 rounded-xl border animate-pulse" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }} />
      </div>
    </div>
  )

  const hot = rows.filter(r => isHot(r.lastMessageAt) && r.status !== 'ended').length

  return (
    // min-h-0 (not h-full) — the workspace layout wrapper is a flex
    // column passing down the bounded viewport height; flex-1 fills it
    // and min-h-0 lets this box shrink to fit, so the panes scroll
    // INTERNALLY and the composer stays pinned. h-full was dead weight:
    // it resolved against an auto-height parent (= no constraint) and
    // the page grew past the fold.
    <div className="flex-1 min-h-0 flex overflow-hidden">
      {/* LEFT PANE — list, filters, search. Fixed width on md+; full
          width on mobile (right pane is hidden via md:flex). */}
      <div
        className="w-full md:w-[440px] lg:w-[480px] md:flex-shrink-0 flex flex-col border-r overflow-y-auto p-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <h1 className="text-lg font-semibold tracking-tight inline-flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            Inbox
            {hot > 0 && (
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-flex items-center gap-1"
                style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
              >
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--accent-emerald)' }} />
                {hot}
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <SoundToggle />
            <button
              type="button"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              className={`text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
                selectMode
                  ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
              title="Select multiple conversations to close at once"
            >
              {selectMode ? 'Done' : 'Select'}
            </button>
            <button
              type="button"
              onClick={togglePresence}
              className={`group flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
                isAvailable
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
              title={isAvailable
                ? 'You\u2019re available — round-robin / first-available routing can land chats with you. Click to go away.'
                : 'You\u2019re away — auto-routing skips you. Click to come back.'}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isAvailable ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
              {isAvailable ? 'Available' : 'Away'}
            </button>
          </div>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300">Run manual_widget_migration.sql to enable the inbox.</p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {([
            { id: 'all', label: 'Everyone' },
            { id: 'mine', label: 'Assigned to me' },
            { id: 'unassigned', label: 'Unassigned' },
          ] as Array<{ id: AssignTab; label: string }>).map(t => {
            const active = assignTab === t.id
            const count = counts[t.id]
            return (
              <button
                key={t.id}
                onClick={() => setAssignTab(t.id)}
                className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors border"
                style={
                  active
                    ? { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)', borderColor: 'var(--accent-primary)' }
                    : { background: 'var(--surface)', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }
                }
              >
                {t.label}
                <span className="ml-1.5" style={{ color: active ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)' }}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* Brand filter — only renders when the workspace actually has
            brands defined. Dropdown form, scales to 50+ brands. */}
        {brands.length > 0 && (() => {
          const counts = rows.reduce((acc, r) => {
            const k = r.brand?.slug ?? '__untagged__'
            acc[k] = (acc[k] ?? 0) + 1
            return acc
          }, {} as Record<string, number>)
          const untaggedCount = counts.__untagged__ ?? 0
          const currentBrand = brandSlug === 'all' ? null
            : brandSlug === 'untagged' ? null
            : brands.find(b => b.slug === brandSlug) ?? null
          const triggerLabel = brandSlug === 'all' ? 'All brands'
            : brandSlug === 'untagged' ? 'Untagged'
            : currentBrand?.name ?? brandSlug
          const triggerCount = brandSlug === 'all' ? rows.length
            : brandSlug === 'untagged' ? untaggedCount
            : (counts[brandSlug] ?? 0)
          const sb = brandSearch.toLowerCase().trim()
          const filteredBrands = sb
            ? brands.filter(b =>
                b.name.toLowerCase().includes(sb)
                || b.slug.toLowerCase().includes(sb))
            : brands
          return (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Brand</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setBrandPickerOpen(o => !o)}
                  className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    brandSlug === 'all'
                      ? 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:text-white hover:border-zinc-600'
                      : 'bg-white text-black border-white'
                  }`}
                >
                  {currentBrand?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={currentBrand.logoUrl} alt="" className="w-3.5 h-3.5 rounded-sm object-cover" />
                  ) : currentBrand?.primaryColor ? (
                    <span className="w-2 h-2 rounded-full" style={{ background: currentBrand.primaryColor }} />
                  ) : null}
                  <span className="truncate max-w-[180px]">{triggerLabel}</span>
                  <span className={brandSlug === 'all' ? 'text-zinc-500' : 'text-zinc-500'}>{triggerCount}</span>
                  <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {brandPickerOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setBrandPickerOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 z-40 w-72 bg-zinc-950 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
                      {brands.length > 6 && (
                        <div className="p-2 border-b border-zinc-800">
                          <input
                            autoFocus
                            value={brandSearch}
                            onChange={e => setBrandSearch(e.target.value)}
                            placeholder="Search brands…"
                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                          />
                        </div>
                      )}
                      <div className="max-h-72 overflow-y-auto py-1">
                        <PickerRow
                          active={brandSlug === 'all'}
                          onClick={() => { setBrandSlug('all'); setBrandPickerOpen(false); setBrandSearch('') }}
                          left={<span className="w-5 h-5 rounded bg-zinc-800 flex items-center justify-center text-[10px] text-zinc-400">∗</span>}
                          label="All brands"
                          count={rows.length}
                        />
                        <PickerRow
                          active={brandSlug === 'untagged'}
                          onClick={() => { setBrandSlug('untagged'); setBrandPickerOpen(false); setBrandSearch('') }}
                          left={<span className="w-5 h-5 rounded border border-dashed border-zinc-700 flex items-center justify-center text-[10px] text-zinc-500">·</span>}
                          label="Untagged"
                          count={untaggedCount}
                        />
                        {filteredBrands.length === 0 && (
                          <p className="px-3 py-2 text-[11px] text-zinc-500">No brands match.</p>
                        )}
                        {filteredBrands.map(b => (
                          <PickerRow
                            key={b.slug}
                            active={brandSlug === b.slug}
                            onClick={() => { setBrandSlug(b.slug); setBrandPickerOpen(false); setBrandSearch('') }}
                            left={
                              b.logoUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={b.logoUrl} alt="" className="w-5 h-5 rounded object-cover" />
                              ) : (
                                <span
                                  className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-semibold text-white"
                                  style={{ background: b.primaryColor || '#fa4d2e' }}
                                >
                                  {b.name.charAt(0).toUpperCase()}
                                </span>
                              )
                            }
                            label={b.name}
                            count={counts[b.slug] ?? 0}
                          />
                        ))}
                      </div>
                      <div className="p-2 border-t border-zinc-800">
                        <Link
                          href={`/dashboard/${workspaceId}/brands`}
                          className="text-[11px] text-zinc-400 hover:text-white"
                        >
                          Manage brands →
                        </Link>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )
        })()}

        {/* Assignee filter — list of workspace members. Only renders
            when there's more than one member; on a single-operator
            workspace this control is just noise. */}
        {members.length > 1 && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Operator</span>
            <select
              value={assigneeFilter ?? ''}
              onChange={e => setAssigneeFilter(e.target.value || null)}
              className="text-xs rounded-full px-3 py-1.5 border"
              style={{
                background: assigneeFilter ? 'var(--surface-tertiary)' : 'var(--surface)',
                color: 'var(--text-primary)',
                borderColor: 'var(--border)',
              }}
            >
              <option value="">All operators</option>
              {members.map(m => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name || m.user.email || 'Unknown'}
                </option>
              ))}
            </select>
            {assigneeFilter && (
              <button
                onClick={() => setAssigneeFilter(null)}
                className="text-[11px] text-zinc-400 hover:text-white underline decoration-zinc-700 hover:decoration-white"
              >
                clear
              </button>
            )}
            <a
              href={(() => {
                const u = new URL(`/api/workspaces/${workspaceId}/widget-conversations/export`, window.location.origin)
                u.searchParams.set('format', 'csv')
                if (brandSlug !== 'all') u.searchParams.set('brand', brandSlug)
                if (assigneeFilter) u.searchParams.set('assignee', assigneeFilter)
                if (tab === 'needs_human') u.searchParams.set('status', 'handed_off')
                return u.pathname + u.search
              })()}
              className="ml-auto text-[11px] font-semibold px-2.5 py-1 rounded border hover:bg-zinc-900 transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              title="Download the current filter as a CSV"
            >
              Export CSV
            </a>
            <a
              href={(() => {
                const u = new URL(`/api/workspaces/${workspaceId}/widget-conversations/export`, window.location.origin)
                u.searchParams.set('format', 'md')
                if (brandSlug !== 'all') u.searchParams.set('brand', brandSlug)
                if (assigneeFilter) u.searchParams.set('assignee', assigneeFilter)
                if (tab === 'needs_human') u.searchParams.set('status', 'handed_off')
                return u.pathname + u.search
              })()}
              className="text-[11px] font-semibold px-2.5 py-1 rounded border hover:bg-zinc-900 transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              title="Download the current filter as Markdown"
            >
              .md
            </a>
          </div>
        )}

        {/* Rating filter — only renders once a single rated chat
            exists, so workspaces that haven't started collecting
            ratings aren't shown an empty UI. Counts compute from the
            current row set. Click an already-active chip to clear. */}
        {(() => {
          const ratedCount = rows.filter(r => typeof r.csatRating === 'number').length
          if (ratedCount === 0) return null
          const counts = {
            rated: ratedCount,
            unrated: rows.length - ratedCount,
            '5': rows.filter(r => r.csatRating === 5).length,
            '4': rows.filter(r => r.csatRating === 4).length,
            '3': rows.filter(r => r.csatRating === 3).length,
            '2': rows.filter(r => r.csatRating === 2).length,
            '1': rows.filter(r => r.csatRating === 1).length,
          }
          const chips: Array<{ id: RatingFilter; label: string; count?: number }> = [
            { id: 'rated', label: 'Rated', count: counts.rated },
            { id: '5', label: '5★', count: counts['5'] },
            { id: '4', label: '4★', count: counts['4'] },
            { id: '3', label: '3★', count: counts['3'] },
            { id: '2', label: '2★', count: counts['2'] },
            { id: '1', label: '1★', count: counts['1'] },
            { id: 'unrated', label: 'Unrated', count: counts.unrated },
          ]
          return (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Rating</span>
              {chips.map(c => {
                const active = ratingFilter === c.id
                const isLow = c.id === '1' || c.id === '2'
                return (
                  <button
                    key={c.id}
                    onClick={() => setRatingFilter(prev => prev === c.id ? 'any' : c.id)}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors border"
                    style={
                      active
                        ? isLow
                          ? { background: 'var(--accent-red-bg)', color: 'var(--accent-red)', borderColor: 'var(--accent-red)' }
                          : { background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)', borderColor: 'var(--accent-amber)' }
                        : { background: 'var(--surface)', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }
                    }
                  >
                    {c.label}
                    {typeof c.count === 'number' && (
                      <span className="ml-1.5" style={{ color: active ? 'inherit' : 'var(--text-muted)' }}>{c.count}</span>
                    )}
                  </button>
                )
              })}
              {ratingFilter !== 'any' && (
                <button
                  onClick={() => setRatingFilter('any')}
                  className="text-[11px] text-zinc-400 hover:text-white underline decoration-zinc-700 hover:decoration-white"
                >
                  clear
                </button>
              )}
            </div>
          )
        })()}

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {([
            { id: 'all', label: 'All' },
            { id: 'unread', label: 'Unread' },
            { id: 'needs_human', label: 'Needs human' },
            { id: 'ai_handled', label: 'AI handled' },
          ] as Array<{ id: StatusTab; label: string }>).map(t => {
            const active = tab === t.id
            const count = counts[t.id]
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors border"
                style={
                  active
                    ? { background: 'var(--surface-tertiary)', color: 'var(--text-primary)', borderColor: 'var(--border-secondary)' }
                    : { background: 'var(--surface)', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }
                }
              >
                {t.label}
                <span className="ml-1.5" style={{ color: 'var(--text-muted)' }}>{count}</span>
              </button>
            )
          })}
          <div className="ml-auto relative">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={brandSlug !== 'all' && brandSlug !== 'untagged'
                ? 'Search transcripts in this brand\u2026'
                : 'Search conversations\u2026'}
              className="w-80 max-w-full rounded-lg pl-9 pr-8 py-1.5 text-xs focus:outline-none transition-colors"
              style={{
                background: 'var(--input-bg)',
                color: 'var(--input-text)',
                border: '1px solid var(--input-border)',
              }}
            />
            <svg className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} style={{ color: 'var(--text-tertiary)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
                title="Clear search"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Search-results banner \u2014 shown whenever a query OR a brand
            filter is active. Surfaces what's being searched + the
            "export these" call-to-action right next to the result
            count, which is the moment operators want it. */}
        {(() => {
          if (!usingSearch) return null
          const currentBrand = brandSlug !== 'all' && brandSlug !== 'untagged'
            ? brands.find(b => b.slug === brandSlug) ?? null
            : null
          const exportable = !!currentBrand
          const exportHref = currentBrand
            ? (() => {
                const u = new URL(`/api/workspaces/${workspaceId}/brands/${currentBrand.id}/transcripts/export`, window.location.origin)
                u.searchParams.set('format', 'json')
                if (search.trim()) u.searchParams.set('q', search.trim())
                return u.pathname + u.search
              })()
            : null
          const textHref = currentBrand
            ? (() => {
                const u = new URL(`/api/workspaces/${workspaceId}/brands/${currentBrand.id}/transcripts/export`, window.location.origin)
                u.searchParams.set('format', 'text')
                if (search.trim()) u.searchParams.set('q', search.trim())
                return u.pathname + u.search
              })()
            : null
          return (
            <div className="flex items-center gap-3 mb-4 px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800">
              <p className="text-xs text-zinc-300">
                <span className="text-zinc-500">Showing</span>{' '}
                <span className="font-semibold text-white">{filtered.length}</span>{' '}
                <span className="text-zinc-500">
                  {filtered.length === 1 ? 'conversation' : 'conversations'}
                  {search.trim() && <> matching <span className="text-orange-300">&ldquo;{search.trim()}&rdquo;</span></>}
                  {currentBrand && <> in {currentBrand.name}</>}
                  {brandSlug === 'untagged' && <> (untagged)</>}
                </span>
              </p>
              {exportable ? (
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[10px] text-zinc-500 mr-1">Export this set</span>
                  <a
                    href={exportHref!}
                    className="text-[11px] font-medium px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                    title="Download as JSON"
                  >
                    JSON
                  </a>
                  <a
                    href={textHref!}
                    className="text-[11px] font-medium px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                    title="Download as plain-text transcript"
                  >
                    Text
                  </a>
                </div>
              ) : (
                search.trim() && (
                  <p className="ml-auto text-[10px] text-zinc-500">Scope to a brand to export this set</p>
                )
              )}
            </div>
          )
        })()}

        {selectMode && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-orange-500/30 bg-orange-500/5">
            <button
              type="button"
              onClick={() => {
                const ids = filtered.filter(r => r.channel === 'widget' && r.status !== 'ended').map(r => r.id)
                const allOn = ids.length > 0 && ids.every(id => selectedIds.has(id))
                setSelectedIds(allOn ? new Set() : new Set(ids))
              }}
              className="text-[11px] font-medium text-zinc-300 hover:text-white"
            >
              Select all
            </button>
            <span className="text-xs text-zinc-400">{selectedIds.size} selected</span>
            <div className="ml-auto flex items-center gap-2">
              {selectedIds.size > 0 && (
                <button type="button" onClick={() => setSelectedIds(new Set())} className="text-[11px] text-zinc-400 hover:text-white">
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => void bulkClose()}
                disabled={selectedIds.size === 0 || bulkClosing}
                className="text-[11px] font-semibold px-2.5 py-1 rounded bg-orange-500 text-white hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {bulkClosing ? 'Closing…' : `Close ${selectedIds.size || ''}`.trim()}
              </button>
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div
            className="text-center py-16 border border-dashed rounded-xl"
            style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface)' }}
          >
            <div
              className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
              style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
              {search.trim() ? 'No matches' :
                assignTab === 'mine' ? 'Nothing assigned to you'
                : assignTab === 'unassigned' ? 'Queue is empty — nice'
                : tab === 'unread' ? 'You’re caught up'
                : tab === 'needs_human' ? 'Nothing waiting on you'
                : tab === 'ai_handled' ? 'Agent hasn’t replied to anything yet'
                : 'No conversations'}
            </p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {search.trim() ? 'Try a different query.'
                : assignTab === 'mine' ? 'Chats land here when teammates assign them or when routing picks you.'
                : assignTab === 'unassigned' ? 'New chats show up here until someone claims them.'
                : 'Conversations land here as visitors chat with your widgets.'}
            </p>
          </div>
        ) : (
          <div
            // flex-shrink-0 is load-bearing: this card's overflow-hidden
            // (there to clip the rounded corners) zeroes its flex
            // automatic minimum, so once the pane became height-bounded
            // it shrank to the leftover space and CLIPPED the rows —
            // measured live: 548px card holding 7,534px of conversations,
            // pane scrollHeight == clientHeight, nothing scrollable.
            // shrink-0 keeps the card at natural height so the pane's
            // own overflow-y-auto scrolls the list like before.
            className="flex-shrink-0 rounded-xl border overflow-hidden divide-y divide-zinc-800"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {filtered.map((r, idx) => {
              const visitorLabel = r.visitor.name || r.visitor.email || `Visitor ${r.visitor.cookieId.slice(-6)}`
              const initial = initialOf(r.visitor.name, r.visitor.email, 'V')
              const accent = r.widget.primaryColor || '#fa4d2e'
              const hot = isHot(r.lastMessageAt) && r.status !== 'ended'
              const isEnded = r.status === 'ended'
              const closedDivider = idx === firstClosedIdx ? (
                <div
                  key={`divider-closed`}
                  className="px-4 py-2 flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold"
                  style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
                >
                  <span className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                  <span>Closed · {filtered.length - firstClosedIdx}</span>
                  <span className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                </div>
              ) : null
              const lastKind = r.lastMessage?.kind
              const isMine = meId && r.assignedUserId === meId
              const isSelected = selectedId === r.id
              // "Unread" treatment: any message arrived after the
              // operator last opened the conversation. Persisted via
              // readAtMap (localStorage-backed). Conversations ended
              // never count as unread because there's nothing to do.
              //
              // We compare the LAST message timestamp against the
              // last-opened timestamp, regardless of who sent it —
              // this is operator-centric ("have I seen the latest
              // state of this thread?"), which is what the user is
              // asking for. Without this, replying via the inbox
              // would clear the bold prematurely (because the latest
              // message becomes the operator's reply) and incoming
              // visitor replies arriving while elsewhere on the
              // dashboard wouldn't re-bold the row.
              const lastReadAt = readAtMap[r.id] ?? 0
              const lastMessageMs = new Date(r.lastMessageAt).getTime()
              const isUnread = r.status !== 'ended' && lastMessageMs > lastReadAt
              const selectable = selectMode && r.channel === 'widget' && r.status !== 'ended'
              return (
                <Fragment key={r.id}>
                  {closedDivider}
                <div className="flex items-stretch">
                {selectMode && (
                  <label
                    className={`flex items-center pl-3 ${selectable ? 'cursor-pointer' : 'opacity-30 cursor-not-allowed'}`}
                    onClick={e => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      disabled={!selectable}
                      checked={selectedIds.has(r.id)}
                      onChange={() => toggleSelect(r.id)}
                      className="w-4 h-4 accent-orange-500"
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (selectable) { toggleSelect(r.id); return }
                    setSelectedId(r.id); markConversationOpened(r.id)
                  }}
                  className={`flex-1 min-w-0 text-left flex items-start gap-3 p-4 transition-colors border-l-2 ${
                    isSelected ? '' : 'hover:bg-zinc-900/60'
                  } ${isEnded && !isSelected ? 'opacity-60' : ''}`}
                  style={
                    isSelected
                      ? { background: 'var(--surface-secondary)', borderLeftColor: 'var(--accent-primary)' }
                      : isUnread
                        ? { background: 'var(--surface)', borderLeftColor: 'var(--accent-emerald)' }
                        : { borderLeftColor: 'transparent' }
                  }
                >
                  <div className="relative flex-shrink-0">
                    {r.visitor.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.visitor.avatarUrl}
                        alt=""
                        className="w-10 h-10 rounded-full object-cover bg-zinc-800"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white"
                        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
                        {initial}
                      </div>
                    )}
                    {/* Channel pill on the avatar — Facebook 'f' for
                        Messenger, IG glyph for Instagram, no badge for
                        widget (the row already lives in the widget
                        feed, so the chip would just be noise). */}
                    {r.channel === 'messenger' && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#1877F2] ring-2 ring-[color:var(--surface)] flex items-center justify-center" title="Facebook Messenger">
                        <FacebookIcon className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                    {r.channel === 'instagram' && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full ring-2 ring-[color:var(--surface)] flex items-center justify-center"
                        style={{ background: 'linear-gradient(135deg,#F58529,#DD2A7B,#8134AF)' }}
                        title="Instagram Direct">
                        <InstagramIcon className="w-2.5 h-2.5 text-white" />
                      </span>
                    )}
                    {hot && r.channel === 'widget' && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-[color:var(--surface)]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      {/* Unread dot — small accent disc next to the
                          name when the operator hasn't opened the
                          conversation since the latest message. Same
                          UX pattern Gmail / Slack / Intercom use. */}
                      {isUnread && (
                        <span
                          aria-label="Unread"
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: 'var(--accent-primary)' }}
                        />
                      )}
                      <p
                        className={`text-sm truncate ${isUnread ? 'font-bold' : 'font-semibold'}`}
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {visitorLabel}
                      </p>
                      {r.brand && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 font-medium"
                          style={{
                            background: `${r.brand.primaryColor || '#fa4d2e'}20`,
                            color: r.brand.primaryColor || '#fa4d2e',
                          }}
                          title={`Brand: ${r.brand.name}`}
                        >
                          {r.brand.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.brand.logoUrl} alt="" className="w-3 h-3 rounded-sm object-cover" />
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: r.brand.primaryColor || '#fa4d2e' }} />
                          )}
                          {r.brand.name}
                        </span>
                      )}
                      {/* Priority group chip — only renders when the
                          brand belongs to a named group AND it's not
                          the lowest tier. Colour falls back to amber
                          for visual urgency on un-coloured groups. */}
                      {r.brandGroup && r.brandGroup.priority < 100 && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 font-semibold"
                          style={{
                            background: `${r.brandGroup.color || '#f59e0b'}22`,
                            color: r.brandGroup.color || '#f59e0b',
                          }}
                          title={`Priority group: ${r.brandGroup.name} (priority ${r.brandGroup.priority})`}
                        >
                          ★ {r.brandGroup.name}
                        </span>
                      )}
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
                      >
                        {r.widget.name}
                      </span>
                      {r.status === 'active' && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
                        >
                          live
                        </span>
                      )}
                      {r.status === 'handed_off' && !r.assignedUserId && (
                        // Handed off but no one's picked it up yet — red to
                        // surface urgency. "Needs human" is clearer than the
                        // old "needs you" (which felt personally addressed
                        // to whoever was viewing, regardless of assignment).
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
                          title="The AI handed this conversation off but no one has taken it yet. Click to reply as a human."
                        >
                          needs human
                        </span>
                      )}
                      {r.status === 'handed_off' && r.assignedUserId && (
                        // Someone's on it — neutral tone, name visible so
                        // the viewer knows who. Avoids the alarmist
                        // "needs you" when in fact another teammate is
                        // already handling.
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
                          title={`Handed off and currently being handled by ${r.assignedUser?.name || 'a teammate'}.`}
                        >
                          {r.assignedUser?.name ? `with ${r.assignedUser.name}` : 'taken over'}
                        </span>
                      )}
                      {r.status === 'ended' && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--surface-secondary)', color: 'var(--text-muted)' }}
                        >
                          ended
                        </span>
                      )}
                      {typeof r.csatRating === 'number' && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                          style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
                        >
                          {r.csatRating}/5
                        </span>
                      )}
                      <span className="ml-auto text-[10px] whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                        {timeAgo(r.lastMessageAt)}
                      </span>
                    </div>
                    {/* When the row matched on a search query, show
                        the snippets with the term highlighted. Falls
                        back to the regular last-message preview when
                        not searching. */}
                    {(r.snippets && r.snippets.length > 0) ? (
                      <div className="space-y-0.5">
                        {r.snippets.slice(0, 2).map((s, i) => (
                          <p key={i} className="text-xs line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>
                            <Highlight text={s} term={search.trim()} />
                          </p>
                        ))}
                        {r.matchedIn && r.matchedIn.length > 0 && (
                          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            matched in {r.matchedIn.join(', ')}
                          </p>
                        )}
                      </div>
                    ) : r.lastMessage ? (
                      <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                        {r.lastMessage.role === 'agent' && (
                          <span
                            className="inline-flex items-center text-[9px] font-bold tracking-wider px-1 py-px rounded mr-1.5 align-middle"
                            style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
                          >
                            AI
                          </span>
                        )}
                        {lastKind === 'image'
                          ? <span className="italic" style={{ color: 'var(--text-muted)' }}>sent an image</span>
                          : lastKind === 'file'
                            ? <span className="italic" style={{ color: 'var(--text-muted)' }}>sent a file</span>
                            : r.lastMessage.content}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-2 mt-1 text-[10px] flex-wrap" style={{ color: 'var(--text-muted)' }}>
                      <span>{r.messageCount} message{r.messageCount === 1 ? '' : 's'}</span>
                      {r.visitor.email && <span>· {r.visitor.email}</span>}
                      {r.assignedUser ? (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
                          style={
                            isMine
                              ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                              : { background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }
                          }
                        >
                          {r.assignedUser.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.assignedUser.image} alt="" className="w-3.5 h-3.5 rounded-full" />
                          ) : (
                            <span
                              className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-semibold"
                              style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}
                            >
                              {initialOf(r.assignedUser.name, r.assignedUser.email)}
                            </span>
                          )}
                          {isMine ? 'You' : (r.assignedUser.name || r.assignedUser.email || 'Assigned')}
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed"
                          style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-tertiary)' }}
                        >
                          unassigned
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                </div>
                </Fragment>
              )
            })}
          </div>
        )}
      </div>

      {/* RIGHT PANE — conversation detail. Renders when a row is
          selected; otherwise an empty state. */}
      <div
        className="hidden md:flex flex-1 min-w-0 flex-col overflow-hidden"
        style={{ background: 'var(--background)' }}
      >
        {selectedId ? (
          <InboxConversationPanel
            key={selectedId}
            workspaceId={workspaceId}
            conversationId={selectedId}
            onClose={() => setSelectedId(null)}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
              style={{ background: 'var(--surface)', color: 'var(--text-tertiary)' }}
            >
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Pick a conversation</p>
            <p className="text-xs max-w-sm" style={{ color: 'var(--text-tertiary)' }}>
              Select a chat from the list on the left to read the full thread, claim it, and reply.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}


function PickerRow({
  active, onClick, left, label, count,
}: {
  active: boolean
  onClick: () => void
  left: ReactNode
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors ${
        active ? 'bg-zinc-900 text-white' : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
      }`}
    >
      {left}
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <span className="text-[10px] text-zinc-500">{count}</span>
      {active && (
        <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  )
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = term.toLowerCase()
  const parts: Array<{ text: string; match: boolean }> = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(needle, i)
    if (idx < 0) {
      parts.push({ text: text.slice(i), match: false })
      break
    }
    if (idx > i) parts.push({ text: text.slice(i, idx), match: false })
    parts.push({ text: text.slice(idx, idx + needle.length), match: true })
    i = idx + needle.length
  }
  return (
    <>
      {parts.map((p, idx) =>
        p.match
          ? <mark key={idx} className="bg-orange-500/30 text-orange-100 rounded px-0.5">{p.text}</mark>
          : <span key={idx}>{p.text}</span>,
      )}
    </>
  )
}

/**
 * Sound on/off toggle for the inbox notification ping. Persists to
 * localStorage via lib/notification-sound so operators don't lose
 * their preference on reload. Clicking it also fires a short test
 * ping when un-muting — confirms audio works AND unlocks the
 * AudioContext (browser autoplay policy: audio can only start
 * after a user gesture, so this click is the canonical unlock).
 */
function SoundToggle() {
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(0.8)
  useEffect(() => {
    setMuted(isNotificationSoundMuted('inbox'))
    setVolume(getNotificationVolume('inbox'))
  }, [])
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          const next = !muted
          setNotificationSoundMuted('inbox', next)
          setMuted(next)
          // Test ping on unmute so the operator hears it work + the
          // browser's audio context gets the gesture it needs.
          if (!next) playNotificationSound('inbox', { variant: 'assignment' })
        }}
        className="group flex items-center justify-center text-[11px] font-medium w-7 h-7 rounded-full border transition-colors border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white"
        title={muted ? 'Notification sound is muted — click to enable' : 'Notification sound on — click to mute'}
        aria-label={muted ? 'Unmute notification sound' : 'Mute notification sound'}
      >
        {muted ? (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        )}
      </button>
      {!muted && (
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          value={volume}
          onChange={e => {
            const v = Number(e.target.value)
            setVolume(v)
            setNotificationVolume('inbox', v)
          }}
          onMouseUp={() => playNotificationSound('inbox', { variant: 'assignment' })}
          className="w-16 accent-orange-500 cursor-pointer"
          title="Notification volume"
          aria-label="Notification volume"
        />
      )}
    </div>
  )
}

function FacebookIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M14 13.5h2.5l1-4H14V7c0-1.03 0-2 2-2h1.5V1.64c-.34-.04-1.62-.14-2.97-.14C11.7 1.5 10 3.16 10 6.2v3.3H7v4h3v9h4v-9z" />
    </svg>
  )
}

function InstagramIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  )
}
