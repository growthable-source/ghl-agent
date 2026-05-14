'use client'

/**
 * Unified operator queue.
 *
 * One chronological view of everything an operator might need to act
 * on — paused conversations, agent errors, stalled threads, pending
 * approvals, recent corrections, scheduled follow-ups. Replaces the
 * mental load of "which of the four sub-pages do I check today?"
 *
 * The four legacy pages (needs-attention, approvals, corrections,
 * next-actions) still work and each row in this feed links through
 * to the relevant detail surface. Once operators have lived with the
 * unified view we can either collapse the legacy pages into filter
 * shortcuts here, or remove them entirely. Until then this is
 * additive — no regressions to existing nav.
 *
 * "Activity" is a separate concept and stays as-is — that's the
 * read-only stream of recent agent events (informational, not
 * actionable). Queue = work to do; Activity = what just happened.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

type Category = 'paused' | 'error' | 'stalled' | 'approval' | 'correction' | 'next_action'
type Severity = 'high' | 'medium' | 'low' | 'info'

interface Item {
  id: string
  category: Category
  severity: Severity
  label: string
  reason?: string
  agent?: { id: string; name: string } | null
  contactId?: string | null
  conversationId?: string | null
  at: string
  href: string
}

interface FeedResponse {
  items: Item[]
  summary: {
    total: number
    high: number
    medium: number
    low: number
    info: number
    byCategory: Partial<Record<Category, number>>
  }
}

const CATEGORY_LABEL: Record<Category, string> = {
  paused: 'Paused',
  error: 'Error',
  stalled: 'Stalled',
  approval: 'Approval',
  correction: 'Correction',
  next_action: 'Follow-up',
}

const CATEGORY_PALETTE: Record<Category, { bg: string; fg: string }> = {
  paused:      { bg: 'var(--accent-red-bg)',     fg: 'var(--accent-red)' },
  error:       { bg: 'var(--accent-red-bg)',     fg: 'var(--accent-red)' },
  stalled:     { bg: 'var(--accent-amber-bg)',   fg: 'var(--accent-amber)' },
  approval:    { bg: 'var(--accent-amber-bg)',   fg: 'var(--accent-amber)' },
  correction:  { bg: 'var(--surface-tertiary)',  fg: 'var(--text-secondary)' },
  next_action: { bg: 'var(--surface-tertiary)',  fg: 'var(--text-tertiary)' },
}

type Filter = 'all' | 'urgent' | Category

export default function QueuePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [feed, setFeed] = useState<FeedResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [lastFetchedAt, setLastFetchedAt] = useState<number>(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/workspaces/${workspaceId}/queue-feed`, { cache: 'no-store' })
        const data = await res.json()
        if (!cancelled) {
          setFeed(data)
          setLastFetchedAt(Date.now())
        }
      } catch {
        // Soft-fail — the feed is supplementary, not load-bearing.
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    // Light polling: 30s while the page is focused. SSE-driven live
    // updates are a later enhancement once we know which channels
    // matter most for operators.
    const t = setInterval(load, 30_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [workspaceId])

  const visible = useMemo(() => {
    if (!feed) return []
    if (filter === 'all') return feed.items
    if (filter === 'urgent') return feed.items.filter(i => i.severity === 'high')
    return feed.items.filter(i => i.category === filter)
  }, [feed, filter])

  return (
    <div className="p-6 max-w-5xl mx-auto w-full">
      <div className="mb-4 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Queue</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            One place for everything that needs your attention. Paused conversations, errors, approvals, corrections, follow-ups — newest first.
          </p>
        </div>
        {feed && (
          <div className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
            {feed.summary.total} total · {feed.summary.high} urgent · refreshes every 30s
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <FilterChip current={filter} value="all" onSelect={setFilter} label="All" count={feed?.summary.total ?? 0} />
        <FilterChip current={filter} value="urgent" onSelect={setFilter} label="Urgent only" count={feed?.summary.high ?? 0} accent />
        <span className="w-px h-5 mx-1" style={{ background: 'var(--border)' }} />
        {(Object.keys(CATEGORY_LABEL) as Category[]).map(cat => (
          <FilterChip
            key={cat}
            current={filter}
            value={cat}
            onSelect={setFilter}
            label={CATEGORY_LABEL[cat]}
            count={feed?.summary.byCategory[cat] ?? 0}
          />
        ))}
      </div>

      {loading && (
        <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading queue…</div>
      )}

      {!loading && visible.length === 0 && (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="text-2xl mb-2">✓</div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {filter === 'all' ? 'Nothing in the queue right now' : `Nothing matches "${labelFor(filter)}"`}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            New items will appear here as agents run.
          </p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          {visible.map((item, idx) => (
            <Link
              key={item.id}
              href={item.href}
              className="block p-4 transition-colors hover:bg-zinc-900/40"
              style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--border)' }}
            >
              <div className="flex items-start gap-3">
                {/* Severity rail — a thin vertical bar on the left
                    matching the category accent. Reads instantly even
                    without parsing the chip text. */}
                <div
                  className="w-1 rounded-full flex-shrink-0 self-stretch"
                  style={{ background: CATEGORY_PALETTE[item.category].fg }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: CATEGORY_PALETTE[item.category].bg, color: CATEGORY_PALETTE[item.category].fg }}
                    >
                      {CATEGORY_LABEL[item.category]}
                    </span>
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {item.label}
                    </p>
                    {item.agent && (
                      <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                        · {item.agent.name}
                      </span>
                    )}
                    <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      {timeAgo(item.at)}
                    </span>
                  </div>
                  {item.reason && (
                    <p className="text-xs line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                      {item.reason}
                    </p>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {feed && lastFetchedAt > 0 && (
        <p className="text-[10px] mt-3 text-right" style={{ color: 'var(--text-muted)' }}>
          Last updated {timeAgo(new Date(lastFetchedAt).toISOString())}
        </p>
      )}
    </div>
  )
}

function FilterChip({ current, value, onSelect, label, count, accent }: {
  current: Filter
  value: Filter
  onSelect: (v: Filter) => void
  label: string
  count: number
  accent?: boolean
}) {
  const active = current === value
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className="text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors"
      style={
        active
          ? { background: accent ? 'var(--accent-red-bg)' : 'var(--surface-secondary)', color: accent ? 'var(--accent-red)' : 'var(--text-primary)', borderColor: accent ? 'var(--accent-red)' : 'var(--border)' }
          : { background: 'transparent', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }
      }
    >
      {label}
      {count > 0 && (
        <span className="ml-1 opacity-70">· {count}</span>
      )}
    </button>
  )
}

function labelFor(filter: Filter): string {
  if (filter === 'all') return 'All'
  if (filter === 'urgent') return 'Urgent'
  return CATEGORY_LABEL[filter]
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) {
    // Future-dated (scheduled follow-up)
    const future = -ms
    const m = Math.round(future / 60_000)
    if (m < 60) return `in ${m}m`
    const h = Math.round(future / 3_600_000)
    if (h < 24) return `in ${h}h`
    return `in ${Math.round(future / 86_400_000)}d`
  }
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
