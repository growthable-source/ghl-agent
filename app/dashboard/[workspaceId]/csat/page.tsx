'use client'

/**
 * Visitor satisfaction dashboard.
 *
 * Aggregates 1–5 star ratings the visitor submits via the widget when
 * a chat closes. Before this page, ratings lived as a single badge in
 * the inbox row — operators had no way to see "how is my agent doing
 * overall." This page answers that: overall average, response rate,
 * distribution histogram, per-agent breakdown, and the 30 most recent
 * ratings with their comments.
 *
 * Filters everything to the trailing N days (7/30/90 toggle). The API
 * caps `days` server-side at 180 so callers can't request the whole
 * history at once.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface CsatResponse {
  days: number
  totalRated: number
  closedTotal: number
  responseRate: number
  averageRating: number
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>
  byAgent: Array<{ agentId: string | null; name: string; count: number; avg: number }>
  recent: Array<{
    conversationId: string
    widgetId: string
    widgetName: string
    agentId: string | null
    agentName: string | null
    rating: number
    comment: string | null
    submittedAt: string | null
    visitorLabel: string
  }>
  notMigrated?: boolean
  error?: string
}

const WINDOWS = [7, 30, 90] as const

export default function CsatPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [data, setData] = useState<CsatResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/csat?days=${days}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, days])

  const maxBar = data
    ? Math.max(1, ...(['1','2','3','4','5'] as const).map(k => data.distribution[k]))
    : 1

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Visitor satisfaction</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              How visitors rated their widget chats. Pulled live from the
              "Rate this chat" prompt — newest first.
            </p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
            {WINDOWS.map(w => (
              <button
                key={w}
                onClick={() => setDays(w)}
                className="text-xs font-medium px-3 py-1 rounded-md transition-colors"
                style={
                  days === w
                    ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                    : { color: 'var(--text-tertiary)' }
                }
              >
                {w}d
              </button>
            ))}
          </div>
        </div>

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
              No ratings yet in the last {days} days
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Ratings appear when visitors tap the stars after a chat ends — either
              the operator marks the chat resolved, or the visitor chooses
              "Rate this chat" from the widget's closure banner.
            </p>
          </div>
        ) : (
          <>
            {/* ── Scorecards ───────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <Scorecard
                label="Average rating"
                value={`${data.averageRating.toFixed(2)} / 5`}
                hint={'⭐'.repeat(Math.round(data.averageRating))}
              />
              <Scorecard
                label="Ratings collected"
                value={String(data.totalRated)}
                hint={`out of ${data.closedTotal} closed chat${data.closedTotal === 1 ? '' : 's'}`}
              />
              <Scorecard
                label="Response rate"
                value={`${Math.round(data.responseRate * 100)}%`}
                hint="of closed chats rated"
              />
            </div>

            {/* ── Distribution histogram ──────────────────────────── */}
            <div
              className="rounded-xl border p-5 mb-6"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Rating distribution</h2>
              <div className="space-y-2">
                {(['5','4','3','2','1'] as const).map(k => {
                  const count = data.distribution[k]
                  const pct = (count / maxBar) * 100
                  const isTop = Number(k) >= 4
                  return (
                    <div key={k} className="flex items-center gap-3">
                      <div className="w-8 text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{k}★</div>
                      <div
                        className="flex-1 h-5 rounded overflow-hidden"
                        style={{ background: 'var(--surface-tertiary)' }}
                      >
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${pct}%`,
                            background: isTop ? 'var(--accent-green, #22c55e)' : Number(k) === 3 ? 'var(--accent-amber, #f59e0b)' : 'var(--accent-red, #ef4444)',
                          }}
                        />
                      </div>
                      <div className="w-10 text-xs tabular-nums text-right" style={{ color: 'var(--text-tertiary)' }}>{count}</div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* ── Per-agent breakdown ─────────────────────────────── */}
            {data.byAgent.length > 0 && (
              <div
                className="rounded-xl border p-5 mb-6"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>By agent</h2>
                <div className="space-y-2">
                  {data.byAgent.map(a => (
                    <div key={a.agentId ?? '∅'} className="flex items-center gap-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
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

            {/* ── Recent ratings ──────────────────────────────────── */}
            <div
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
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
                        {r.agentName && (
                          <>
                            <span>·</span>
                            <span>{r.agentName}</span>
                          </>
                        )}
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
    </div>
  )
}

function Scorecard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
        {label}
      </p>
      <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
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
