'use client'

/**
 * Tickets reports — scorecards, trend deltas, distributions, and
 * per-brand / per-operator rollups. Same query-string convention as
 * the list page so an operator can drill from list filters into the
 * report under the same scope.
 *
 * Each card row links back to the list page with the corresponding
 * filter pre-applied — so clicking "Brand X · 12 open" lands you on
 * the list filtered to that brand's in-flight tickets.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import DateRangePicker, { todayISO, daysAgoISO } from '@/components/csat/DateRangePicker'

interface BrandLite { id: string; name: string; primaryColor: string | null }

interface ReportsData {
  inactive: boolean
  reason?: string
  days: number
  from: string
  to: string
  filters: { brandId: string | null }
  scorecards: { open: number; created: number; closed: number; avgResolutionHours: number | null }
  trend: {
    deltaCreated: number; deltaClosed: number
    deltaAvgResolutionHours: number | null
    priorCreated: number; priorClosed: number
    priorAvgResolutionHours: number | null
  }
  byStatus:   Array<{ status: string; count: number }>
  byPriority: Array<{ priority: string; count: number }>
  byBrand:    Array<{ brandId: string | null; name: string; color: string | null; count: number; openCount: number; avgResolutionHours: number | null }>
  byOperator: Array<{ userId: string; name: string; email: string | null; image: string | null; count: number; openCount: number; avgResolutionHours: number | null }>
  created:    Array<{ day: string; count: number }>
  closed:     Array<{ day: string; count: number }>
  allBrands:  BrandLite[]
}

const STATUS_TONES: Record<string, string> = {
  open: '#3b82f6', pending: '#f59e0b', on_hold: '#a855f7', resolved: '#22c55e', closed: '#71717a',
}
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', pending: 'Pending', on_hold: 'On hold', resolved: 'Resolved', closed: 'Closed',
}
const PRIORITY_TONE: Record<string, string> = {
  low: '#71717a', normal: '#71717a', high: '#f59e0b', urgent: '#ef4444',
}

export default function TicketsReportsPage() {
  const params = useParams()
  const search = useSearchParams()
  const workspaceId = params.workspaceId as string

  // Seed from URL — letting the list page deep-link with its own
  // filters preserved. Defaults to 30d / no brand filter.
  const initialBrand = search.get('brandId') ?? 'all'
  const initialFrom = search.get('from')
  const initialTo = search.get('to')
  const initialDays = search.get('days')

  const [brandFilter, setBrandFilter] = useState<string>(initialBrand) // 'all' | 'no_brand' | brandId
  const [dateMode, setDateMode] = useState<'preset' | 'custom'>(initialFrom && initialTo ? 'custom' : 'preset')
  const [days, setDays] = useState<7 | 30 | 90>(initialDays && [7,30,90].includes(Number(initialDays)) ? Number(initialDays) as 7 | 30 | 90 : 30)
  const [customFrom, setCustomFrom] = useState<string>(initialFrom ?? daysAgoISO(30))
  const [customTo, setCustomTo] = useState<string>(initialTo ?? todayISO())

  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)

  const queryString = useMemo(() => {
    const q = new URLSearchParams()
    if (brandFilter !== 'all') q.set('brandId', brandFilter)
    if (dateMode === 'custom') { q.set('from', customFrom); q.set('to', customTo) }
    else q.set('days', String(days))
    return q.toString()
  }, [brandFilter, dateMode, days, customFrom, customTo])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/tickets/reports?${queryString}`)
      const d: ReportsData = await res.json()
      setData(d)
    } finally { setLoading(false) }
  }, [workspaceId, queryString])

  useEffect(() => { load() }, [load])

  // Helper: build a list-page link with the same filters carried over.
  const listLink = (extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(queryString)
    for (const [k, v] of Object.entries(extra)) q.set(k, v)
    return `/dashboard/${workspaceId}/tickets?${q.toString()}`
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <Link href={`/dashboard/${workspaceId}/tickets`} className="text-xs hover:underline" style={{ color: 'var(--text-tertiary)' }}>
              ← All tickets
            </Link>
            <h1 className="text-2xl font-bold mt-2" style={{ color: 'var(--text-primary)' }}>Ticket reports</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Click any card to drill into the list filtered to that scope.
            </p>
          </div>
          <DateRangePicker
            mode={dateMode}
            days={days}
            customFrom={customFrom}
            customTo={customTo}
            onPreset={d => { setDateMode('preset'); setDays(d) }}
            onToggleCustom={() => setDateMode(dateMode === 'custom' ? 'preset' : 'custom')}
            onCustomFrom={setCustomFrom}
            onCustomTo={setCustomTo}
          />
        </div>

        {/* Brand filter row */}
        {(data?.allBrands?.length ?? 0) > 0 && (
          <div className="mb-5 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] uppercase tracking-wider font-semibold mr-1" style={{ color: 'var(--text-tertiary)' }}>Brand</span>
            <Chip active={brandFilter === 'all'} onClick={() => setBrandFilter('all')}>All brands</Chip>
            {data?.allBrands?.map(b => (
              <Chip key={b.id} active={brandFilter === b.id} tone={b.primaryColor ?? undefined} onClick={() => setBrandFilter(b.id)}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: b.primaryColor ?? 'var(--text-tertiary)' }} />
                  {b.name}
                </span>
              </Chip>
            ))}
            <Chip active={brandFilter === 'no_brand'} onClick={() => setBrandFilter('no_brand')}>(no brand)</Chip>
          </div>
        )}

        {loading && !data ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
        ) : data?.inactive ? (
          <div className="rounded-xl border p-10 text-center" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Ticketing isn&apos;t active for this workspace.</p>
            <Link href={`/dashboard/${workspaceId}/settings/ticketing`} className="text-xs underline mt-2 inline-block" style={{ color: 'var(--accent-primary)' }}>Open settings →</Link>
          </div>
        ) : data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
              <Scorecard label="Currently open"   value={String(data.scorecards.open)}                 hint="open + pending + on hold (snapshot)" />
              <Scorecard label="Created"          value={String(data.scorecards.created)}              hint={`in last ${data.days}d`} delta={data.trend.deltaCreated} priorLabel={`vs ${data.trend.priorCreated} prior`} />
              <Scorecard label="Closed"           value={String(data.scorecards.closed)}               hint={`in last ${data.days}d`} delta={data.trend.deltaClosed} priorLabel={`vs ${data.trend.priorClosed} prior`} />
              <Scorecard label="Avg resolution"   value={data.scorecards.avgResolutionHours !== null ? formatHours(data.scorecards.avgResolutionHours) : '—'} hint="time from open → closed" delta={data.trend.deltaAvgResolutionHours ?? undefined} priorLabel={data.trend.priorAvgResolutionHours !== null ? `vs ${formatHours(data.trend.priorAvgResolutionHours)} prior` : undefined} deltaLowerIsBetter />
            </div>

            {/* Trend chart: created vs closed daily */}
            <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
              <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Volume over time</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Tickets <span style={{ color: STATUS_TONES.open }}>created</span> vs <span style={{ color: STATUS_TONES.resolved }}>closed</span> per day.
              </p>
              <TimeSeriesChart created={data.created} closed={data.closed} />
            </div>

            {/* By status + priority — side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <DistributionCard
                title="By status"
                rows={data.byStatus.map(r => ({
                  key: r.status,
                  label: STATUS_LABEL[r.status] ?? r.status,
                  tone: STATUS_TONES[r.status] ?? '#71717a',
                  count: r.count,
                  href: listLink({ status: r.status }),
                }))}
              />
              <DistributionCard
                title="By priority"
                rows={data.byPriority.map(r => ({
                  key: r.priority,
                  label: r.priority,
                  tone: PRIORITY_TONE[r.priority] ?? '#71717a',
                  count: r.count,
                  href: listLink({ priority: r.priority }),
                }))}
              />
            </div>

            {/* By brand */}
            {data.byBrand.length > 0 && (
              <Section title="By brand" hint="Click a row to filter the list to that brand.">
                <RollupTable
                  rows={data.byBrand.map(b => ({
                    key: b.brandId ?? '_no_brand',
                    label: b.name,
                    color: b.color,
                    count: b.count,
                    openCount: b.openCount,
                    avgHours: b.avgResolutionHours,
                    href: listLink({ brandId: b.brandId ?? 'no_brand' }),
                  }))}
                />
              </Section>
            )}

            {/* By human operator */}
            {data.byOperator.length > 0 && (
              <Section title="By operator" hint="Tickets owned by each teammate this period.">
                <RollupTable
                  rows={data.byOperator.map(o => ({
                    key: o.userId,
                    label: o.name,
                    avatarImage: o.image,
                    count: o.count,
                    openCount: o.openCount,
                    avgHours: o.avgResolutionHours,
                    href: listLink({ assignee: o.userId }),
                  }))}
                />
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Scorecard({ label, value, hint, delta, priorLabel, deltaLowerIsBetter }: {
  label: string; value: string; hint?: string
  delta?: number; priorLabel?: string; deltaLowerIsBetter?: boolean
}) {
  const showDelta = delta !== undefined && delta !== 0
  const isGood = delta !== undefined && (deltaLowerIsBetter ? delta < 0 : delta > 0)
  const sign = delta !== undefined && delta > 0 ? '+' : ''
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <div className="flex items-baseline gap-2 mt-1 flex-wrap">
        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
        {showDelta && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            title={priorLabel}
            style={{
              background: isGood ? 'var(--accent-green-bg, rgba(34,197,94,0.15))' : 'var(--accent-red-bg)',
              color: isGood ? 'var(--accent-green, #22c55e)' : 'var(--accent-red)',
            }}
          >
            {sign}{Number.isInteger(delta) ? delta : delta!.toFixed(1)}
          </span>
        )}
      </div>
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
      {priorLabel && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{priorLabel}</p>}
    </div>
  )
}

function DistributionCard({ title, rows }: {
  title: string
  rows: Array<{ key: string; label: string; tone: string; count: number; href: string }>
}) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <div className="space-y-2">
        {rows.map(r => {
          const pct = (r.count / max) * 100
          return (
            <Link key={r.key} href={r.href} className="block w-full flex items-center gap-3 px-2 py-1 rounded hover:bg-zinc-900/40 transition-colors">
              <div className="w-20 text-xs capitalize" style={{ color: 'var(--text-secondary)' }}>{r.label}</div>
              <div className="flex-1 h-5 rounded overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
                <div className="h-full transition-all" style={{ width: `${pct}%`, background: r.tone }} />
              </div>
              <div className="w-10 text-xs tabular-nums text-right" style={{ color: 'var(--text-tertiary)' }}>{r.count}</div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      {hint && <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
      {children}
    </div>
  )
}

function RollupTable({ rows }: {
  rows: Array<{ key: string; label: string; color?: string | null; avatarImage?: string | null; count: number; openCount: number; avgHours: number | null; href: string }>
}) {
  return (
    <div className="space-y-1">
      {rows.map(r => (
        <Link key={r.key} href={r.href} className="flex items-center gap-3 py-2 px-2 rounded hover:bg-zinc-900/40 transition-colors">
          {r.avatarImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.avatarImage} alt="" className="w-5 h-5 rounded-full shrink-0" />
          ) : r.color ? (
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
          ) : (
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: 'var(--surface-tertiary)' }} />
          )}
          <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{r.label}</span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }} title="Open + pending + on-hold">
            {r.openCount} open
          </span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
            {r.count} total
          </span>
          <span className="text-xs font-medium tabular-nums w-20 text-right" style={{ color: 'var(--text-primary)' }} title="Average time from open to closed">
            {r.avgHours !== null ? formatHours(r.avgHours) : '—'}
          </span>
        </Link>
      ))}
    </div>
  )
}

function TimeSeriesChart({ created, closed }: { created: Array<{ day: string; count: number }>; closed: Array<{ day: string; count: number }> }) {
  const max = Math.max(1, ...created.map(p => p.count), ...closed.map(p => p.count))
  // Step width — let the chart fill horizontally. For 30 days that's
  // ~16px per bar group; for 90 days it shrinks proportionally.
  return (
    <div className="flex items-end gap-1 h-32">
      {created.map((c, i) => {
        const cl = closed[i]?.count ?? 0
        const cPct = (c.count / max) * 100
        const lPct = (cl / max) * 100
        return (
          <div key={c.day} className="flex-1 flex items-end gap-px" title={`${c.day} · ${c.count} created · ${cl} closed`}>
            <div className="flex-1 rounded-t" style={{ height: `${cPct}%`, background: STATUS_TONES.open, minHeight: c.count > 0 ? 2 : 0 }} />
            <div className="flex-1 rounded-t" style={{ height: `${lPct}%`, background: STATUS_TONES.resolved, minHeight: cl > 0 ? 2 : 0 }} />
          </div>
        )
      })}
    </div>
  )
}

function Chip({ active, tone, onClick, children }: { active: boolean; tone?: string; onClick: () => void; children: React.ReactNode }) {
  const accent = tone ?? 'var(--accent-primary)'
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium px-3 py-1 rounded-full transition-colors"
      style={active
        ? { background: tone ? `${tone}1A` : 'var(--accent-primary-bg)', color: accent, border: `1px solid ${accent}` }
        : { background: 'var(--surface)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}
    >
      {children}
    </button>
  )
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`
  if (h < 48) return `${h.toFixed(1)}h`
  return `${(h / 24).toFixed(1)}d`
}
