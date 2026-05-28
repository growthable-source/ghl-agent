'use client'

/**
 * ToolGateStats — workspace-level analytics surface for Phase B3's
 * enforced-tool gate. Renders three stat cards (total checks /
 * allowed % / blocked count), a "by tool" table with allow/block
 * counts and p50 latency, plus the last 20 blocked decisions for
 * quick pattern-spotting.
 *
 * Window: 7d / 14d / 30d / 90d switcher. Defaults to 14d to match
 * the API.
 *
 * Empty state explicitly names the enforced tools so operators
 * understand why the page might be quiet — the gate only fires for
 * the catalog-flagged tools.
 */

import { useCallback, useEffect, useState } from 'react'

interface ByToolRow {
  toolName: string
  allowed: number
  blocked: number
  p50LatencyMs: number
  topBlockReasons: Array<{ reason: string; count: number }>
}

interface RecentBlocked {
  id: string
  agentId: string
  toolName: string
  reason: string
  createdAt: string
}

interface StatsResponse {
  windowDays: number
  totalChecks: number
  allowed: number
  blocked: number
  p50LatencyMs: number
  p95LatencyMs: number
  totalInputTokens: number
  totalOutputTokens: number
  byTool: ByToolRow[]
  recentBlocked: RecentBlocked[]
}

const ENFORCED_TOOLS = [
  'book_appointment',
  'mark_opportunity_won',
  'send_email',
  'create_shopify_checkout',
  'create_shopify_discount',
  'mark_opportunity_lost',
]

const WINDOW_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 7, label: '7d' },
  { value: 14, label: '14d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
]

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function pct(part: number, whole: number): string {
  if (whole === 0) return '—'
  return `${Math.round((part / whole) * 1000) / 10}%`
}

export default function ToolGateStats({ workspaceId }: { workspaceId: string }) {
  const [days, setDays] = useState<number>(14)
  const [data, setData] = useState<StatsResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tool-gate-stats?days=${days}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: StatsResponse = await res.json()
      setData(json)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, days])

  useEffect(() => { fetchStats() }, [fetchStats])

  // Find the largest blocked count so we can scale the inline bars.
  // Defensive against an all-zero set.
  const maxBlocked = data?.byTool.reduce((m, r) => Math.max(m, r.blocked), 0) ?? 0

  return (
    <div>
      {/* Window selector */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Window
        </span>
        <div
          className="flex gap-1 p-1 rounded-lg"
          style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
        >
          {WINDOW_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className="text-xs font-medium px-3 py-1 rounded transition-colors"
              style={
                days === opt.value
                  ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                  : { color: 'var(--text-secondary)' }
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
        {data && !loading && (
          <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
            p50 {data.p50LatencyMs}ms · p95 {data.p95LatencyMs}ms
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="h-24 rounded-xl animate-pulse"
                style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
              />
            ))}
          </div>
          <div
            className="h-40 rounded-xl animate-pulse"
            style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
          />
        </div>
      ) : error ? (
        <div
          className="p-4 rounded-xl text-sm"
          style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
        >
          {error}
        </div>
      ) : data && data.totalChecks === 0 ? (
        <div
          className="p-6 rounded-xl text-sm leading-relaxed"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No gate decisions yet.
          </p>
          <p>
            Decisions will appear here once an agent calls{' '}
            {ENFORCED_TOOLS.map((t, i) => (
              <span key={t}>
                <code
                  className="font-mono text-xs px-1 py-0.5 rounded"
                  style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }}
                >
                  {t}
                </code>
                {i < ENFORCED_TOOLS.length - 2 ? ', ' : i === ENFORCED_TOOLS.length - 2 ? ', or ' : ''}
              </span>
            ))}
            .
          </p>
        </div>
      ) : data ? (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <StatCard
              label="Total checks"
              value={data.totalChecks.toLocaleString()}
              hint={`Last ${data.windowDays} days`}
            />
            <StatCard
              label="Allowed"
              value={pct(data.allowed, data.totalChecks)}
              hint={`${data.allowed.toLocaleString()} of ${data.totalChecks.toLocaleString()}`}
              tone="emerald"
            />
            <StatCard
              label="Blocked"
              value={data.blocked.toLocaleString()}
              hint={pct(data.blocked, data.totalChecks)}
              tone="red"
            />
          </div>

          {/* By-tool table */}
          <div
            className="rounded-xl overflow-hidden mb-6"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div
              className="px-4 py-3 text-xs uppercase tracking-wider font-semibold"
              style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}
            >
              By tool
            </div>
            {data.byTool.length === 0 ? (
              <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                No tool calls in this window.
              </div>
            ) : (
              <div>
                <div
                  className="grid items-center px-4 py-2 text-[10px] uppercase tracking-wider font-semibold"
                  style={{
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border)',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr',
                  }}
                >
                  <span>Tool</span>
                  <span className="text-right">Allowed</span>
                  <span className="text-right">Blocked</span>
                  <span className="text-right">p50 ms</span>
                  <span>Top block reasons</span>
                </div>
                {data.byTool.map(row => (
                  <div
                    key={row.toolName}
                    className="grid items-center px-4 py-3 text-xs"
                    style={{
                      borderBottom: '1px solid var(--border)',
                      gridTemplateColumns: '2fr 1fr 1fr 1fr 2fr',
                    }}
                  >
                    <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                      {row.toolName}
                    </span>
                    <span className="text-right" style={{ color: 'var(--text-secondary)' }}>
                      {row.allowed.toLocaleString()}
                    </span>
                    <span className="text-right" style={{ color: row.blocked > 0 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                      <span className="inline-flex items-center justify-end gap-2">
                        {row.blocked > 0 && maxBlocked > 0 && (
                          <span
                            className="inline-block h-1.5 rounded-full"
                            style={{
                              width: `${Math.max(8, (row.blocked / maxBlocked) * 48)}px`,
                              background: 'var(--accent-red)',
                              opacity: 0.5,
                            }}
                          />
                        )}
                        {row.blocked.toLocaleString()}
                      </span>
                    </span>
                    <span className="text-right" style={{ color: 'var(--text-secondary)' }}>
                      {row.p50LatencyMs}
                    </span>
                    <span style={{ color: 'var(--text-tertiary)' }}>
                      {row.topBlockReasons.length === 0 ? (
                        <span style={{ color: 'var(--text-muted)' }}>—</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {row.topBlockReasons.map(r => (
                            <span key={r.reason} className="truncate" title={r.reason}>
                              <span style={{ color: 'var(--text-primary)' }}>{r.count}×</span>{' '}
                              <span className="font-mono">{r.reason}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent blocked */}
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div
              className="px-4 py-3 text-xs uppercase tracking-wider font-semibold"
              style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}
            >
              Recent blocked decisions
            </div>
            {data.recentBlocked.length === 0 ? (
              <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
                Nothing blocked in this window — agents are passing every gate.
              </div>
            ) : (
              <div>
                {data.recentBlocked.map(r => (
                  <div
                    key={r.id}
                    className="px-4 py-3 text-xs flex items-start gap-3"
                    style={{ borderBottom: '1px solid var(--border)' }}
                  >
                    <span className="font-mono shrink-0" style={{ color: 'var(--text-primary)' }}>
                      {r.toolName}
                    </span>
                    <span
                      className="font-mono flex-1 truncate"
                      style={{ color: 'var(--text-tertiary)' }}
                      title={r.reason}
                    >
                      {r.reason}
                    </span>
                    <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {timeAgo(r.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'emerald' | 'red'
}) {
  const valueColor =
    tone === 'emerald'
      ? 'var(--accent-emerald)'
      : tone === 'red'
        ? 'var(--accent-red)'
        : 'var(--text-primary)'
  return (
    <div
      className="p-4 rounded-xl"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
        {label}
      </p>
      <p className="text-2xl font-bold" style={{ color: valueColor }}>
        {value}
      </p>
      {hint && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}
