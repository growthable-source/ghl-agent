'use client'

/**
 * Visitor satisfaction dashboard.
 *
 * Aggregates 1–5 star ratings from widget conversations. Supports
 * click-to-filter drill-down on:
 *   - rating bars (only show 4★ chats)
 *   - brand rows (only show ratings for one brand)
 *   - handler pill (AI-only vs human-touched)
 * Every filter is sent to /api/workspaces/:id/csat as a query param so
 * scorecards, distribution, and per-X breakdowns all recompute
 * server-side under the active filter.
 *
 * "Print report" opens /csat/report in a new tab — that page sets
 * window.print() on load, giving the operator a clean browser
 * save-as-PDF. "Email report" posts to /csat/email which renders an
 * HTML version and sends it via Resend.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface CommentHighlight {
  conversationId: string
  widgetName: string
  brandName: string | null
  agentName: string | null
  operatorName: string | null
  handler: 'ai' | 'human'
  rating: number
  comment: string
  submittedAt: string | null
  visitorLabel: string
}

interface CsatResponse {
  days: number
  filters: { brandId: string | null; rating: number | null; handler: 'ai' | 'human' | null }
  totalRated: number
  closedTotal: number
  responseRate: number
  averageRating: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
  byAgent: Array<{ agentId: string | null; name: string; count: number; avg: number }>
  byOperator: Array<{ userId: string; name: string; email: string | null; image: string | null; count: number; avg: number }>
  byBrand: Array<{ brandId: string | null; name: string; color: string | null; count: number; avg: number }>
  byHandler: { ai: { count: number; avg: number }; human: { count: number; avg: number } }
  trend: {
    priorAvg: number | null
    priorCount: number
    priorResponseRate: number
    deltaAvg: number | null
    deltaCount: number
    deltaResponseRate: number
  }
  commentHighlights: {
    needsReview: Array<CommentHighlight>
    brightSpots: Array<CommentHighlight>
  }
  allBrands: Array<{ id: string; name: string; primaryColor: string | null }>
  recent: Array<{
    conversationId: string
    widgetId: string
    widgetName: string
    brandId: string | null
    brandName: string | null
    agentId: string | null
    agentName: string | null
    handler: 'ai' | 'human'
    rating: number
    comment: string | null
    submittedAt: string | null
    visitorLabel: string
  }>
  notMigrated?: boolean
  error?: string
}

const WINDOWS = [7, 30, 90] as const

/**
 * Today's date in YYYY-MM-DD form, browser-local. Used to seed the
 * "to" calendar input — we don't want it to default to UTC midnight
 * when the operator's already past midnight local.
 */
function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function daysAgoISO(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export default function CsatPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  // Date window state. mode='preset' uses one of the trailing-days
  // buckets (7/30/90); mode='custom' uses explicit from/to dates.
  // Two-mode state lets the operator flip back to a preset without
  // losing the custom range entirely.
  const [mode, setMode] = useState<'preset' | 'custom'>('preset')
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [customFrom, setCustomFrom] = useState<string>(daysAgoISO(30))
  const [customTo, setCustomTo] = useState<string>(todayISO())
  const [brandId, setBrandId] = useState<string | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [handler, setHandler] = useState<'ai' | 'human' | null>(null)
  const [data, setData] = useState<CsatResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [emailModalOpen, setEmailModalOpen] = useState(false)

  const queryString = useMemo(() => {
    const q = new URLSearchParams()
    if (mode === 'custom') {
      q.set('from', customFrom)
      q.set('to', customTo)
    } else {
      q.set('days', String(days))
    }
    if (brandId) q.set('brandId', brandId)
    if (rating) q.set('rating', String(rating))
    if (handler) q.set('handler', handler)
    return q.toString()
  }, [mode, days, customFrom, customTo, brandId, rating, handler])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/csat?${queryString}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, queryString])

  const maxBar = data
    ? Math.max(1, ...(['1','2','3','4','5'] as const).map(k => data.distribution[k]))
    : 1

  const hasFilter = brandId !== null || rating !== null || handler !== null
  const clearFilters = useCallback(() => { setBrandId(null); setRating(null); setHandler(null) }, [])

  const printUrl = `/dashboard/${workspaceId}/csat/report?${queryString}`

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Visitor satisfaction</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Click any bar, brand, or handler pill to drill in. Reset filters with the chip&nbsp;×.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={printUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-2 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              📄 Print / PDF
            </a>
            <button
              onClick={() => setEmailModalOpen(true)}
              className="text-xs font-semibold px-3 py-2 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              📧 Email report
            </button>
            <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
              {WINDOWS.map(w => (
                <button
                  key={w}
                  onClick={() => { setMode('preset'); setDays(w) }}
                  className="text-xs font-medium px-3 py-1 rounded-md transition-colors"
                  style={
                    mode === 'preset' && days === w
                      ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                      : { color: 'var(--text-tertiary)' }
                  }
                >
                  {w}d
                </button>
              ))}
              <button
                onClick={() => setMode(mode === 'custom' ? 'preset' : 'custom')}
                className="text-xs font-medium px-3 py-1 rounded-md transition-colors"
                style={
                  mode === 'custom'
                    ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                    : { color: 'var(--text-tertiary)' }
                }
                title="Custom date range"
              >
                📅 Custom
              </button>
            </div>
            {mode === 'custom' && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="text-xs rounded-lg px-2 py-1.5"
                  style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
                />
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>→</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  max={todayISO()}
                  onChange={e => setCustomTo(e.target.value)}
                  className="text-xs rounded-lg px-2 py-1.5"
                  style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Filter chips — always visible when any filter is on */}
        {hasFilter && (
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Filtered by</span>
            {rating !== null && (
              <FilterChip onClear={() => setRating(null)}>
                {rating}★ only
              </FilterChip>
            )}
            {brandId !== null && (() => {
              const brand = data?.allBrands.find(b => b.id === brandId)
              return (
                <FilterChip onClear={() => setBrandId(null)} color={brand?.primaryColor ?? undefined}>
                  {brand?.name || 'Brand'}
                </FilterChip>
              )
            })()}
            {handler !== null && (
              <FilterChip onClear={() => setHandler(null)}>
                {handler === 'ai' ? 'AI-only chats' : 'Human-touched chats'}
              </FilterChip>
            )}
            <button
              onClick={clearFilters}
              className="text-[11px] underline ml-1"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Clear all
            </button>
          </div>
        )}

        {data?.notMigrated && (
          <div className="p-4 mb-6 rounded-xl" style={{ background: 'var(--accent-amber-bg)', border: '1px solid var(--accent-amber-bg)' }}>
            <p className="text-sm" style={{ color: 'var(--accent-amber)' }}>{data.error}</p>
          </div>
        )}

        {loading ? (
          <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading ratings…</div>
        ) : !data || data.totalRated === 0 ? (
          <div
            className="rounded-xl border p-10 text-center"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <div className="text-3xl mb-2">⭐</div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {hasFilter ? 'No ratings match these filters' : `No ratings yet in the last ${days} days`}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {hasFilter
                ? 'Try clearing one of the filters above.'
                : 'Ratings appear when visitors tap the stars after a chat ends.'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <Scorecard
                label="Average rating"
                value={`${data.averageRating.toFixed(2)} / 5`}
                hint={'⭐'.repeat(Math.round(data.averageRating))}
                delta={data.trend.deltaAvg !== null ? { value: data.trend.deltaAvg, suffix: '', goodIfPositive: true, priorLabel: `vs ${data.trend.priorAvg?.toFixed(2) ?? '—'} prior ${data.days}d` } : null}
              />
              <Scorecard
                label="Ratings collected"
                value={String(data.totalRated)}
                hint={`out of ${data.closedTotal} closed chat${data.closedTotal === 1 ? '' : 's'}`}
                delta={{ value: data.trend.deltaCount, suffix: '', goodIfPositive: true, priorLabel: `vs ${data.trend.priorCount} prior ${data.days}d`, format: 'integer' }}
              />
              <Scorecard
                label="Response rate"
                value={`${Math.round(data.responseRate * 100)}%`}
                hint="of closed chats rated"
                delta={{ value: Math.round(data.trend.deltaResponseRate * 100), suffix: 'pp', goodIfPositive: true, priorLabel: `vs ${Math.round(data.trend.priorResponseRate * 100)}% prior ${data.days}d`, format: 'integer' }}
              />
            </div>

            {/* AI vs Human comparison */}
            <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>AI vs human</h2>
              <div className="grid grid-cols-2 gap-3">
                <HandlerCard
                  label="AI only"
                  helper="No human took over"
                  count={data.byHandler.ai.count}
                  avg={data.byHandler.ai.avg}
                  active={handler === 'ai'}
                  onClick={() => setHandler(handler === 'ai' ? null : 'ai')}
                />
                <HandlerCard
                  label="Human-touched"
                  helper="Operator stepped in"
                  count={data.byHandler.human.count}
                  avg={data.byHandler.human.avg}
                  active={handler === 'human'}
                  onClick={() => setHandler(handler === 'human' ? null : 'human')}
                />
              </div>
              {data.byHandler.ai.count > 0 && data.byHandler.human.count > 0 && (
                <p className="text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
                  Difference: <strong style={{ color: 'var(--text-secondary)' }}>
                    {(data.byHandler.human.avg - data.byHandler.ai.avg >= 0 ? '+' : '')}
                    {(data.byHandler.human.avg - data.byHandler.ai.avg).toFixed(2)}
                  </strong> for human-touched
                  ({data.byHandler.human.avg > data.byHandler.ai.avg ? 'humans rate higher' :
                    data.byHandler.human.avg < data.byHandler.ai.avg ? 'AI rates higher' :
                    'tied'})
                </p>
              )}
            </div>

            {/* Rating distribution — click to filter */}
            <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Rating distribution</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>Click a row to drill in to just that rating.</p>
              <div className="space-y-2">
                {(['5','4','3','2','1'] as const).map(k => {
                  const count = data.distribution[k]
                  const pct = (count / maxBar) * 100
                  const isTop = Number(k) >= 4
                  const active = rating === Number(k)
                  return (
                    <button
                      key={k}
                      onClick={() => setRating(active ? null : Number(k))}
                      className="w-full flex items-center gap-3 px-2 py-1 rounded transition-colors hover:bg-zinc-900/40"
                      style={active ? { background: 'var(--accent-primary-bg)' } : undefined}
                    >
                      <div className="w-8 text-xs tabular-nums text-left" style={{ color: active ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>{k}★</div>
                      <div className="flex-1 h-5 rounded overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background: isTop ? 'var(--accent-green, #22c55e)' : Number(k) === 3 ? 'var(--accent-amber, #f59e0b)' : 'var(--accent-red, #ef4444)',
                          }}
                        />
                      </div>
                      <div className="w-10 text-xs tabular-nums text-right" style={{ color: 'var(--text-tertiary)' }}>{count}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Per-brand — click to filter */}
            {data.byBrand.length > 0 && (
              <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>By brand</h2>
                <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
                  {brandId ? 'Filtered. Click again to clear.' : 'Click any brand to scope the whole dashboard to it.'}
                </p>
                <div className="space-y-1">
                  {data.byBrand.map(b => {
                    const active = brandId === b.brandId
                    return (
                      <button
                        key={b.brandId ?? '∅'}
                        onClick={() => b.brandId && setBrandId(active ? null : b.brandId)}
                        disabled={!b.brandId}
                        className="w-full flex items-center gap-3 py-2 px-2 rounded transition-colors hover:bg-zinc-900/40 disabled:cursor-default"
                        style={active ? { background: 'var(--accent-primary-bg)' } : undefined}
                      >
                        {b.color ? (
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: b.color }} />
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--surface-tertiary)' }} />
                        )}
                        <span className="text-sm flex-1 truncate text-left" style={{ color: active ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                          {b.name}
                        </span>
                        <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                          {b.count} rating{b.count === 1 ? '' : 's'}
                        </span>
                        <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                          {b.avg.toFixed(2)} <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>/ 5</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* By AI agent */}
            {data.byAgent.length > 0 && (
              <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  By AI agent <span className="text-[10px] uppercase tracking-wider font-normal" style={{ color: 'var(--text-tertiary)' }}>· purple = AI</span>
                </h2>
                <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
                  Rating spread across each AI agent config. A chat that handed off to a human is still counted here — the rating reflects the whole experience.
                </p>
                <div className="space-y-2">
                  {data.byAgent.map(a => (
                    <div key={a.agentId ?? '∅'} className="flex items-center gap-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-purple-400" />
                      {a.agentId ? (
                        <Link
                          href={`/dashboard/${workspaceId}/agents/${a.agentId}`}
                          className="text-sm flex-1 truncate hover:underline"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {a.name}
                        </Link>
                      ) : (
                        <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-tertiary)' }}>{a.name}</span>
                      )}
                      <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                        {a.count} rating{a.count === 1 ? '' : 's'}
                      </span>
                      <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        {a.avg.toFixed(2)} <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>/ 5</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* By human operator — same shape but keyed off assignedUserId */}
            {data.byOperator.length > 0 && (
              <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  By human operator <span className="text-[10px] uppercase tracking-wider font-normal" style={{ color: 'var(--text-tertiary)' }}>· blue = human</span>
                </h2>
                <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
                  Ratings on chats your teammates were assigned to. A chat appears under both AI and human if it handed off.
                </p>
                <div className="space-y-2">
                  {data.byOperator.map(o => (
                    <div key={o.userId} className="flex items-center gap-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      {o.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.image} alt="" className="w-6 h-6 rounded-full shrink-0" />
                      ) : (
                        <span className="w-6 h-6 rounded-full shrink-0 bg-blue-500/20 text-blue-300 text-[10px] font-semibold flex items-center justify-center">
                          {(o.name || o.email || '?').charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{o.name}</p>
                        {o.email && o.email !== o.name && (
                          <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{o.email}</p>
                        )}
                      </div>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                        {o.count} rating{o.count === 1 ? '' : 's'}
                      </span>
                      <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
                        {o.avg.toFixed(2)} <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>/ 5</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Comment highlights — actionable signal pulled out of the
                long recent list. Shows the worst-rated chats with a
                comment (review these), and the best-rated with a
                comment (celebrate / pull quotes). */}
            {(data.commentHighlights.needsReview.length > 0 || data.commentHighlights.brightSpots.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {data.commentHighlights.needsReview.length > 0 && (
                  <div className="rounded-xl border p-5" style={{ borderColor: 'var(--accent-red)', background: 'var(--surface)' }}>
                    <h2 className="text-sm font-semibold mb-1 flex items-center gap-2" style={{ color: 'var(--accent-red)' }}>
                      ⚠️ Needs review
                    </h2>
                    <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>Lowest-rated chats with feedback.</p>
                    <div className="space-y-3">
                      {data.commentHighlights.needsReview.map(h => (
                        <CommentRow key={h.conversationId} workspaceId={workspaceId} highlight={h} />
                      ))}
                    </div>
                  </div>
                )}
                {data.commentHighlights.brightSpots.length > 0 && (
                  <div className="rounded-xl border p-5" style={{ borderColor: 'var(--accent-green, #22c55e)', background: 'var(--surface)' }}>
                    <h2 className="text-sm font-semibold mb-1 flex items-center gap-2" style={{ color: 'var(--accent-green, #22c55e)' }}>
                      ✨ Bright spots
                    </h2>
                    <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>Top-rated chats with feedback. Pull-quotes live here.</p>
                    <div className="space-y-3">
                      {data.commentHighlights.brightSpots.map(h => (
                        <CommentRow key={h.conversationId} workspaceId={workspaceId} highlight={h} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
                <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent ratings</h2>
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                  Click through to see the full conversation in the inbox.
                </p>
              </div>
              {data.recent.map(r => (
                <Link
                  key={r.conversationId}
                  href={`/dashboard/${workspaceId}/inbox?conversation=${r.conversationId}`}
                  className="block p-4 border-t hover:bg-zinc-900/40 transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="text-sm font-semibold tabular-nums w-12 text-center py-1 rounded"
                      style={{ background: r.rating >= 4 ? 'var(--accent-green-bg, rgba(34,197,94,0.15))' : r.rating === 3 ? 'var(--accent-amber-bg)' : 'var(--accent-red-bg)', color: r.rating >= 4 ? 'var(--accent-green, #22c55e)' : r.rating === 3 ? 'var(--accent-amber)' : 'var(--accent-red)' }}
                    >
                      {r.rating}★
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--text-tertiary)' }}>
                        <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{r.visitorLabel}</span>
                        <span>·</span>
                        <span>{r.widgetName}</span>
                        {r.brandName && (<>
                          <span>·</span>
                          <span>{r.brandName}</span>
                        </>)}
                        {r.agentName && (<>
                          <span>·</span>
                          <span>{r.agentName}</span>
                        </>)}
                        <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold ${r.handler === 'human' ? 'bg-blue-500/10 text-blue-300' : 'bg-purple-500/10 text-purple-300'}`}>
                          {r.handler}
                        </span>
                        <span className="ml-auto">{r.submittedAt ? timeAgo(r.submittedAt) : ''}</span>
                      </div>
                      {r.comment && (
                        <p className="text-sm mt-1 italic line-clamp-3" style={{ color: 'var(--text-primary)' }}>
                          &ldquo;{r.comment}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      {emailModalOpen && (
        <EmailReportModal
          workspaceId={workspaceId}
          queryString={queryString}
          onClose={() => setEmailModalOpen(false)}
        />
      )}
    </div>
  )
}

interface Delta {
  value: number
  suffix: string
  goodIfPositive: boolean
  priorLabel: string
  format?: 'integer' | 'decimal'
}

function Scorecard({ label, value, hint, delta }: { label: string; value: string; hint?: string; delta?: Delta | null }) {
  const showDelta = delta && delta.value !== 0
  const isGood = delta && ((delta.value > 0) === delta.goodIfPositive)
  const fmt = delta?.format === 'integer'
    ? `${delta.value > 0 ? '+' : ''}${delta.value}`
    : `${delta && delta.value > 0 ? '+' : ''}${delta?.value.toFixed(2) ?? ''}`
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <div className="flex items-baseline gap-2 mt-1 flex-wrap">
        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
        {showDelta && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            title={delta!.priorLabel}
            style={{
              background: isGood ? 'var(--accent-green-bg, rgba(34,197,94,0.15))' : 'var(--accent-red-bg)',
              color: isGood ? 'var(--accent-green, #22c55e)' : 'var(--accent-red)',
            }}
          >
            {fmt}{delta!.suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
      {delta && (
        <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{delta.priorLabel}</p>
      )}
    </div>
  )
}

function CommentRow({ workspaceId, highlight }: { workspaceId: string; highlight: CommentHighlight }) {
  const bg = highlight.rating >= 4 ? 'var(--accent-green-bg, rgba(34,197,94,0.15))' : highlight.rating === 3 ? 'var(--accent-amber-bg)' : 'var(--accent-red-bg)'
  const fg = highlight.rating >= 4 ? 'var(--accent-green, #22c55e)' : highlight.rating === 3 ? 'var(--accent-amber)' : 'var(--accent-red)'
  return (
    <Link
      href={`/dashboard/${workspaceId}/inbox?conversation=${highlight.conversationId}`}
      className="block p-3 rounded-lg hover:opacity-80 transition-opacity"
      style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start gap-2">
        <span className="text-xs font-semibold tabular-nums shrink-0 px-2 py-0.5 rounded"
          style={{ background: bg, color: fg }}>
          {highlight.rating}★
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm italic line-clamp-3" style={{ color: 'var(--text-primary)' }}>
            &ldquo;{highlight.comment}&rdquo;
          </p>
          <div className="flex items-center gap-2 flex-wrap text-[10px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
            <span>{highlight.visitorLabel}</span>
            {highlight.brandName && (<><span>·</span><span>{highlight.brandName}</span></>)}
            {highlight.operatorName && (<><span>·</span><span className="text-blue-300">{highlight.operatorName}</span></>)}
            {!highlight.operatorName && highlight.agentName && (<><span>·</span><span className="text-purple-300">{highlight.agentName}</span></>)}
          </div>
        </div>
      </div>
    </Link>
  )
}

function HandlerCard({ label, helper, count, avg, active, onClick }: {
  label: string; helper: string; count: number; avg: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg p-4 text-left transition-all border"
      style={active
        ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
        : { borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: active ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}>
        {label}
      </p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {count > 0 ? avg.toFixed(2) : '—'}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {count} rating{count === 1 ? '' : 's'}
        </span>
      </div>
      <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>{helper}</p>
    </button>
  )
}

function FilterChip({ children, onClear, color }: {
  children: React.ReactNode
  onClear: () => void
  color?: string
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full border"
      style={{
        borderColor: color || 'var(--accent-primary)',
        background: color ? `${color}1A` : 'var(--accent-primary-bg)',
        color: color || 'var(--accent-primary)',
      }}
    >
      {children}
      <button onClick={onClear} aria-label="Clear filter" className="opacity-70 hover:opacity-100">×</button>
    </span>
  )
}

function EmailReportModal({ workspaceId, queryString, onClose }: {
  workspaceId: string; queryString: string; onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function send() {
    if (!email.includes('@')) {
      setResult({ ok: false, message: 'Enter a valid email address.' })
      return
    }
    setSending(true)
    setResult(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/csat/email?${queryString}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult({ ok: false, message: data.error || 'Failed to send.' })
      } else {
        setResult({ ok: true, message: `Sent to ${email}.` })
      }
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-2xl max-w-md w-full p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Email this report</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
          Sends the CSAT report (with current filters applied) as a readable HTML email.
        </p>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="recipient@example.com"
          autoFocus
          className="w-full rounded-lg px-3 py-2 text-sm mb-3"
          style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
        />
        {result && (
          <p className="text-xs mb-3" style={{ color: result.ok ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
            {result.message}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-2" style={{ color: 'var(--text-tertiary)' }}>Cancel</button>
          <button
            onClick={send}
            disabled={sending || !email}
            className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
