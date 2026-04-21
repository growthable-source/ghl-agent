/**
 * Tiny, dependency-free time-series chart for the admin overview.
 *
 * Renders a single-metric bar chart with a baseline line — shows 30
 * days at a glance without pulling in Recharts/Chart.js. Server-safe
 * (no 'use client') so it renders inline in the overview page.
 *
 * One design choice worth calling out: we use SVG bars rather than a
 * line chart. With daily buckets and counts that routinely hit zero
 * (new signups, errors), bars read cleaner — no confusing connecting
 * lines across empty days.
 */

interface Point {
  label: string            // e.g. "2026-04-21"
  value: number
}

interface Props {
  data: Point[]
  height?: number          // px
  accent?: 'blue' | 'emerald' | 'red' | 'amber'
  title?: string
}

export function Sparkline({ data, height = 80, accent = 'blue', title }: Props) {
  if (data.length === 0) {
    return (
      <div className="text-xs text-zinc-600 h-20 flex items-center justify-center">
        No data.
      </div>
    )
  }

  const max = Math.max(1, ...data.map(p => p.value))
  const total = data.reduce((a, p) => a + p.value, 0)
  const W = 100
  const H = 100
  // 2 units of horizontal gap between bars so they read as discrete
  // buckets rather than a solid wall.
  const gap = 2
  const barW = (W - gap * (data.length - 1)) / data.length

  const fillClass = {
    blue: 'fill-blue-500/60',
    emerald: 'fill-emerald-500/60',
    red: 'fill-red-500/70',
    amber: 'fill-amber-500/60',
  }[accent]

  return (
    <div>
      {title && (
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-[11px] uppercase tracking-wider text-zinc-500">{title}</p>
          <p className="text-[11px] text-zinc-400">{total.toLocaleString()} total</p>
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {data.map((p, i) => {
          const barH = max > 0 ? (p.value / max) * H : 0
          const x = i * (barW + gap)
          const y = H - barH
          // Give zero-value days a 1-unit stub so the operator can still
          // see the bucket exists (vs "did the cron not run?"). Colour it
          // dimmer so it's obviously a zero.
          const zeroStub = p.value === 0
          return (
            <rect
              key={i}
              x={x}
              y={zeroStub ? H - 1 : y}
              width={barW}
              height={zeroStub ? 1 : Math.max(barH, 0.5)}
              className={zeroStub ? 'fill-zinc-700' : fillClass}
            >
              <title>{p.label}: {p.value}</title>
            </rect>
          )
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-zinc-600 mt-1 font-mono">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  )
}
