'use client'

import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

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

interface Row {
  id: string
  widget: { id: string; name: string; primaryColor?: string }
  brand: Brand | null
  visitor: { id: string; name: string | null; email: string | null; cookieId: string }
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

type StatusTab = 'live' | 'handed_off' | 'ended' | 'all'
type AssignTab = 'all' | 'mine' | 'unassigned'

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
  const [tab, setTab] = useState<StatusTab>('live')
  const [assignTab, setAssignTab] = useState<AssignTab>('all')
  const [search, setSearch] = useState('')
  const [meId, setMeId] = useState<string | null>(null)
  const [isAvailable, setIsAvailable] = useState<boolean>(true)
  // Brand filter — value is the brand *slug*. 'all' = no filter,
  // 'untagged' = conversations on widgets that aren't tagged to any
  // brand. Initial value comes from ?brand=<slug> on the URL so the
  // brands page can deep-link straight into the brand-scoped inbox.
  const [brandSlug, setBrandSlug] = useState<string>(searchParams.get('brand') || 'all')
  const [brandPickerOpen, setBrandPickerOpen] = useState(false)
  const [brandSearch, setBrandSearch] = useState('')

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
    const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations`)
    const data = await res.json()
    setRows(data.conversations || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId, usingSearch, search, brandSlug])

  // Bootstrap: load current user + presence flag + brands in parallel.
  useEffect(() => {
    ;(async () => {
      try {
        const [meRes, presenceRes, brandsRes] = await Promise.all([
          fetch('/api/me'),
          fetch(`/api/workspaces/${workspaceId}/me/presence`),
          fetch(`/api/workspaces/${workspaceId}/brands`),
        ])
        const me = await meRes.json()
        const p = await presenceRes.json()
        const b = await brandsRes.json()
        if (me?.user?.id) setMeId(me.user.id)
        if (typeof p?.isAvailable === 'boolean') setIsAvailable(p.isAvailable)
        if (Array.isArray(b?.brands)) setBrands(b.brands)
      } catch { /* fail-open: keep defaults */ }
    })()
  }, [workspaceId])

  // Keep ?brand=<slug> in sync with the dropdown so deep-links and back-
  // button navigation behave naturally.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (brandSlug === 'all') url.searchParams.delete('brand')
    else url.searchParams.set('brand', brandSlug)
    router.replace(url.pathname + url.search, { scroll: false })
  }, [brandSlug, router])

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
    const i = setInterval(fetchRows, 8000)
    return () => clearInterval(i)
  }, [fetchRows, usingSearch])

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
    const live = rows.filter(r => r.status === 'active').length
    const handed = rows.filter(r => r.status === 'handed_off').length
    const ended = rows.filter(r => r.status === 'ended').length
    const mine = meId ? rows.filter(r => r.assignedUserId === meId).length : 0
    const unassigned = rows.filter(r => !r.assignedUserId).length
    return { live, handed_off: handed, ended, all: rows.length, mine, unassigned }
  }, [rows, meId])

  const filtered = useMemo(() => {
    let f = rows
    if (tab === 'live') f = f.filter(r => r.status === 'active')
    else if (tab === 'handed_off') f = f.filter(r => r.status === 'handed_off')
    else if (tab === 'ended') f = f.filter(r => r.status === 'ended')

    if (assignTab === 'mine' && meId) f = f.filter(r => r.assignedUserId === meId)
    else if (assignTab === 'unassigned') f = f.filter(r => !r.assignedUserId)

    // When `usingSearch` is true the server already applied brand +
    // free-text filters. The status / assignment tabs are still
    // client-side because they're cheap to flip and don't change the
    // underlying result set semantically — operators expect them to
    // narrow what's already on screen.
    return f
  }, [rows, tab, assignTab, meId])

  if (loading) return (
    <div className="flex-1 p-8">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="h-16 bg-zinc-900/40 rounded-xl border border-zinc-800 animate-pulse" />
        <div className="h-16 bg-zinc-900/40 rounded-xl border border-zinc-800 animate-pulse" />
      </div>
    </div>
  )

  const hot = rows.filter(r => isHot(r.lastMessageAt) && r.status !== 'ended').length

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              Inbox
              {hot > 0 && (
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {hot} active now
                </span>
              )}
            </h1>
            <p className="text-sm text-zinc-400 mt-1">Live chat conversations across every widget in this workspace.</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={togglePresence}
              className={`group flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                isAvailable
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
              title={isAvailable
                ? 'You\u2019re available — round-robin / first-available routing can land chats with you. Click to go away.'
                : 'You\u2019re away — auto-routing skips you. Click to come back.'}
            >
              <span className={`w-2 h-2 rounded-full ${isAvailable ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
              {isAvailable ? 'Available' : 'Away'}
            </button>
            <div className="text-[11px] text-zinc-500">Auto-refreshes every 8s · {rows.length} total</div>
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
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  active
                    ? 'bg-orange-500 text-white'
                    : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 ${active ? 'text-orange-100' : 'text-zinc-600'}`}>{count}</span>
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

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {([
            { id: 'live', label: 'Live' },
            { id: 'handed_off', label: 'Handed off' },
            { id: 'ended', label: 'Ended' },
            { id: 'all', label: 'All' },
          ] as Array<{ id: StatusTab; label: string }>).map(t => {
            const active = tab === t.id
            const count = counts[t.id]
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  active
                    ? 'bg-white text-black'
                    : 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
                }`}
              >
                {t.label}
                <span className={`ml-1.5 ${active ? 'text-zinc-500' : 'text-zinc-600'}`}>{count}</span>
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
                : 'Search transcripts, visitors, assignees\u2026'}
              className="w-80 max-w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-8 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
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

        {filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">📥</div>
            <p className="text-sm font-medium text-white mb-1">
              {search.trim() ? 'No matches' :
                assignTab === 'mine' ? 'Nothing assigned to you'
                : assignTab === 'unassigned' ? 'Queue is empty — nice'
                : tab === 'live' ? 'Nothing live right now' : 'No conversations'}
            </p>
            <p className="text-xs text-zinc-500">
              {search.trim() ? 'Try a different query.'
                : assignTab === 'mine' ? 'Chats land here when teammates assign them or when routing picks you.'
                : assignTab === 'unassigned' ? 'New chats show up here until someone claims them.'
                : 'Conversations land here as visitors chat with your widgets.'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden bg-zinc-950">
            {filtered.map(r => {
              const visitorLabel = r.visitor.name || r.visitor.email || `Visitor ${r.visitor.cookieId.slice(-6)}`
              const initial = initialOf(r.visitor.name, r.visitor.email, 'V')
              const accent = r.widget.primaryColor || '#fa4d2e'
              const hot = isHot(r.lastMessageAt) && r.status !== 'ended'
              const lastKind = r.lastMessage?.kind
              const isMine = meId && r.assignedUserId === meId
              return (
                <Link
                  key={r.id}
                  href={`/dashboard/${workspaceId}/inbox/${r.id}`}
                  className="flex items-start gap-3 p-4 hover:bg-zinc-900/60 transition-colors"
                >
                  <div className="relative flex-shrink-0">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold text-white"
                      style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
                      {initial}
                    </div>
                    {hot && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="text-sm font-semibold text-white truncate">{visitorLabel}</p>
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
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{r.widget.name}</span>
                      {r.status === 'active' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">live</span>
                      )}
                      {r.status === 'handed_off' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400">taken over</span>
                      )}
                      {r.status === 'ended' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">ended</span>
                      )}
                      {typeof r.csatRating === 'number' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 inline-flex items-center gap-0.5">
                          ⭐ {r.csatRating}/5
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-500 whitespace-nowrap">{timeAgo(r.lastMessageAt)}</span>
                    </div>
                    {/* When the row matched on a search query, show
                        the snippets with the term highlighted. Falls
                        back to the regular last-message preview when
                        not searching. */}
                    {(r.snippets && r.snippets.length > 0) ? (
                      <div className="space-y-0.5">
                        {r.snippets.slice(0, 2).map((s, i) => (
                          <p key={i} className="text-xs text-zinc-400 line-clamp-2">
                            <span className="text-zinc-600">💬</span>{' '}
                            <Highlight text={s} term={search.trim()} />
                          </p>
                        ))}
                        {r.matchedIn && r.matchedIn.length > 0 && (
                          <p className="text-[10px] text-zinc-600">
                            matched in {r.matchedIn.join(', ')}
                          </p>
                        )}
                      </div>
                    ) : r.lastMessage ? (
                      <p className="text-xs text-zinc-400 truncate">
                        <span className="text-zinc-600">
                          {r.lastMessage.role === 'visitor' ? '👤' : r.lastMessage.role === 'agent' ? '🤖' : 'ℹ️'}
                        </span>{' '}
                        {lastKind === 'image' ? <span className="text-zinc-500 italic">sent an image</span>
                          : lastKind === 'file' ? <span className="text-zinc-500 italic">sent a file</span>
                          : r.lastMessage.content}
                      </p>
                    ) : null}
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-600 flex-wrap">
                      <span>{r.messageCount} message{r.messageCount === 1 ? '' : 's'}</span>
                      {r.visitor.email && <span>· {r.visitor.email}</span>}
                      {r.assignedUser ? (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
                          isMine
                            ? 'bg-orange-500/15 text-orange-300'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}>
                          {r.assignedUser.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.assignedUser.image} alt="" className="w-3.5 h-3.5 rounded-full" />
                          ) : (
                            <span className="w-3.5 h-3.5 rounded-full bg-zinc-700 flex items-center justify-center text-[8px] font-semibold text-white">
                              {initialOf(r.assignedUser.name, r.assignedUser.email)}
                            </span>
                          )}
                          {isMine ? 'You' : (r.assignedUser.name || r.assignedUser.email || 'Assigned')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-zinc-700 text-zinc-500">
                          unassigned
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
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
