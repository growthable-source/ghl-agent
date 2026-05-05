'use client'

/**
 * Ad performance dashboard.
 *
 * Reads /api/workspaces/[id]/ad-metrics (which only reads the persisted
 * AdDailyMetric / GoogleAdMetric tables — no live API calls). Operator
 * can toggle the window (7 / 30 / 90 days).
 *
 * Visualises:
 *   - Workspace KPI tiles: total spend, leads/conversions, CTR, CPL
 *   - Stacked daily spend chart across all accounts
 *   - Per-account breakdown table with sparklines
 *
 * Charts are drawn with inline SVG — keeps the bundle tiny vs adding
 * a chart library, and they're simple enough that hand-drawing is fine.
 */

import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface AccountSeries {
  accountId: string
  provider: 'meta' | 'google'
  accountName: string
  days: Array<{ date: string; spend: number; impressions: number; clicks: number; leadsOrConversions: number; ctr: number | null; cpl: number | null }>
  totals: { spend: number; impressions: number; clicks: number; leadsOrConversions: number; ctr: number | null; cpl: number | null }
}

interface MetricsResponse {
  days: number
  since: string
  workspaceTotals: { spend: number; impressions: number; clicks: number; leadsOrConversions: number; ctr: number | null; cpl: number | null }
  accountSeries: AccountSeries[]
}

const card: CSSProperties = {
  background: 'var(--surface)',
  borderWidth: '1px',
  borderStyle: 'solid',
  borderColor: 'var(--border)',
}

export default function AdPerformancePage() {
  const params = useParams<{ workspaceId: string }>()
  const { workspaceId } = params
  const [windowDays, setWindowDays] = useState(30)
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId) return
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/ad-metrics?days=${windowDays}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`)
        return r.json() as Promise<MetricsResponse>
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Load failed'))
      .finally(() => setLoading(false))
  }, [workspaceId, windowDays])

  // Combine per-day across all accounts for the stacked chart.
  const combinedDaily = useMemo(() => {
    if (!data) return [] as Array<{ date: string; spend: number; leads: number }>
    const map = new Map<string, { date: string; spend: number; leads: number }>()
    for (const acc of data.accountSeries) {
      for (const d of acc.days) {
        const cur = map.get(d.date) ?? { date: d.date, spend: 0, leads: 0 }
        cur.spend += d.spend
        cur.leads += d.leadsOrConversions
        map.set(d.date, cur)
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
  }, [data])

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href={`/dashboard/${workspaceId}/ads`} className="text-sm hover:underline" style={{ color: 'var(--accent-primary)' }}>
            ← Ads
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Performance
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Spend, leads/conversions, CTR, and CPL across every connected ad account. Synced daily by <code style={{ color: 'var(--accent-primary)' }}>/api/cron/sync-ad-metrics</code>.
          </p>
        </div>
        <div className="flex gap-1">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setWindowDays(d)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium"
              style={
                windowDays === d
                  ? { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
                  : { background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }
              }
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg p-3 text-sm" style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}>
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="rounded-xl p-10 text-center text-sm" style={{ ...card, color: 'var(--text-tertiary)' }}>Loading…</div>
      ) : !data || data.accountSeries.length === 0 ? (
        <div className="rounded-xl p-10 text-center" style={card}>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            No metrics yet. The cron runs at 04:30 UTC daily — connect an ad account from{' '}
            <Link href={`/dashboard/${workspaceId}/integrations`} className="hover:underline" style={{ color: 'var(--accent-primary)' }}>Integrations</Link>{' '}
            and check back tomorrow.
          </p>
        </div>
      ) : (
        <>
          {/* KPI tiles */}
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <Kpi label="Spend" value={`$${data.workspaceTotals.spend.toFixed(2)}`} hint={`Last ${windowDays}d`} />
            <Kpi label="Leads / conversions" value={data.workspaceTotals.leadsOrConversions.toLocaleString()} />
            <Kpi label="CTR" value={data.workspaceTotals.ctr === null ? '—' : `${(data.workspaceTotals.ctr * 100).toFixed(2)}%`} />
            <Kpi label="CPL / CPA" value={data.workspaceTotals.cpl === null ? '—' : `$${data.workspaceTotals.cpl.toFixed(2)}`} />
          </section>

          {/* Daily spend chart */}
          <section className="rounded-xl p-5 mb-6" style={card}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Daily spend</h2>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{combinedDaily.length} days</span>
            </div>
            <Chart rows={combinedDaily.map((d) => ({ x: d.date, value: d.spend }))} height={140} suffix="$" />
          </section>

          {/* Per-account table */}
          <section className="rounded-xl p-5" style={card}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Per-account</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ color: 'var(--text-tertiary)' }} className="text-left">
                    <th className="py-2 pr-3 font-medium">Account</th>
                    <th className="py-2 pr-3 font-medium">Platform</th>
                    <th className="py-2 pr-3 font-medium text-right">Spend</th>
                    <th className="py-2 pr-3 font-medium text-right">Leads/Conv.</th>
                    <th className="py-2 pr-3 font-medium text-right">CTR</th>
                    <th className="py-2 pr-3 font-medium text-right">CPL/CPA</th>
                    <th className="py-2 pr-3 font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accountSeries.map((acc) => (
                    <tr key={acc.accountId} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="py-2 pr-3 font-medium" style={{ color: 'var(--text-primary)' }}>{acc.accountName}</td>
                      <td className="py-2 pr-3 uppercase" style={{ color: 'var(--text-tertiary)' }}>{acc.provider}</td>
                      <td className="py-2 pr-3 text-right font-mono">${acc.totals.spend.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right font-mono">{acc.totals.leadsOrConversions}</td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {acc.totals.ctr === null ? '—' : `${(acc.totals.ctr * 100).toFixed(2)}%`}
                      </td>
                      <td className="py-2 pr-3 text-right font-mono">
                        {acc.totals.cpl === null ? '—' : `$${acc.totals.cpl.toFixed(2)}`}
                      </td>
                      <td className="py-2 pr-3 w-32">
                        <Sparkline rows={acc.days.map((d) => d.spend)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  )
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl p-4" style={card}>
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <p className="mt-1 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {hint && <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
    </div>
  )
}

function Chart({ rows, height = 120, suffix = '' }: { rows: Array<{ x: string; value: number }>; height?: number; suffix?: string }) {
  if (rows.length === 0) {
    return <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No data in range.</div>
  }
  const w = 800
  const max = Math.max(1, ...rows.map((r) => r.value))
  const barW = w / rows.length
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }} role="img" aria-label="Daily chart">
      {rows.map((r, i) => {
        const h = (r.value / max) * (height - 16)
        return (
          <g key={r.x}>
            <rect
              x={i * barW + 1}
              y={height - h - 1}
              width={Math.max(1, barW - 2)}
              height={Math.max(1, h)}
              fill="var(--accent-primary)"
              opacity={0.85}
            />
          </g>
        )
      })}
      {/* Y-axis label (max) */}
      <text x={6} y={12} fontSize="10" fill="var(--text-tertiary)">
        {suffix === '$' ? '$' : ''}{Math.round(max).toLocaleString()}{suffix !== '$' ? suffix : ''}
      </text>
    </svg>
  )
}

function Sparkline({ rows }: { rows: number[] }) {
  if (rows.length === 0) return <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>—</span>
  const w = 120
  const h = 24
  const max = Math.max(1, ...rows)
  const points = rows.map((v, i) => {
    const x = (i / Math.max(1, rows.length - 1)) * w
    const y = h - (v / max) * (h - 2)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h }}>
      <polyline points={points} fill="none" stroke="var(--accent-primary)" strokeWidth={1.5} />
    </svg>
  )
}
