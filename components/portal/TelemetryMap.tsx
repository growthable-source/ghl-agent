/**
 * Self-contained global telemetry map for the portal Overview.
 *
 * Real data only — each marker is a location we actually saw visitors
 * from (Vercel edge geo, aggregated by country). The backdrop is a dotted
 * world map: a real equirectangular land mask (Natural Earth 110m, public
 * domain — see world-dots.ts) rendered as dots so markers land on actual
 * continents. No external map asset / expiring CDN; the mask is vendored.
 *
 * Alignment: both the land dots and the markers use the same full-bleed
 * equirectangular projection (lng [-180,180] → x%, lat [90,-90] → y%), so
 * a marker sits exactly where its country is on the dotted landmass.
 */

import { WORLD_COLS, WORLD_ROWS, WORLD_MASK } from './world-dots'

export interface GeoPoint {
  country: string   // ISO-2
  lat: number
  lng: number
  count: number
}

// equirectangular: lng [-180,180] → x%, lat [90,-90] → y%
function project(lat: number, lng: number) {
  return { x: ((lng + 180) / 360) * 100, y: ((90 - lat) / 180) * 100 }
}

// Land cells parsed once at module load → [col, row] pairs.
const LAND_CELLS: Array<[number, number]> = (() => {
  const cells: Array<[number, number]> = []
  for (let i = 0; i < WORLD_MASK.length; i++) {
    if (WORLD_MASK[i] === '1') cells.push([i % WORLD_COLS, Math.floor(i / WORLD_COLS)])
  }
  return cells
})()

export default function TelemetryMap({ points }: { points: GeoPoint[] }) {
  const max = points.length ? Math.max(...points.map(p => p.count)) : 1
  const top = [...points].sort((a, b) => b.count - a.count)

  return (
    <div className="relative rounded-lg overflow-hidden h-64" style={{ background: 'var(--surface-secondary)' }}>
      <WorldDots />

      <div className="absolute inset-0">
        {top.map((p, i) => {
          const { x, y } = project(p.lat, p.lng)
          const r = 5 + Math.round((p.count / max) * 14) // px radius
          const showLabel = i < 6
          return (
            <div key={p.country} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${y}%` }}>
              <span
                className="block rounded-full animate-pulse"
                style={{
                  width: r, height: r,
                  background: 'var(--portal-accent)',
                  boxShadow: `0 0 0 ${Math.round(r / 2)}px color-mix(in srgb, var(--portal-accent) 18%, transparent), 0 0 ${r}px color-mix(in srgb, var(--portal-accent) 50%, transparent)`,
                }}
                title={`${p.country} · ${p.count.toLocaleString()} ${p.count === 1 ? 'chat' : 'chats'}`}
              />
              {showLabel && (
                <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1 whitespace-nowrap text-[9px] font-semibold px-1.5 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--text-secondary)' }}>
                  {p.country} · {p.count.toLocaleString()}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-center px-6">
          <div className="rounded-lg px-3 py-2" style={{ background: 'color-mix(in srgb, var(--surface) 80%, transparent)' }}>
            <p className="text-xs text-zinc-400">No visitor locations yet.</p>
            <p className="text-[10px] text-zinc-600 mt-1">The map lights up as visitors open a chat — location is captured automatically.</p>
          </div>
        </div>
      )}

      {points.length > 0 && (
        <div className="absolute bottom-2 left-3 text-[9px] text-zinc-500">
          {points.length} {points.length === 1 ? 'country' : 'countries'} · {points.reduce((s, p) => s + p.count, 0).toLocaleString()} chats
        </div>
      )}
    </div>
  )
}

// Dotted equirectangular world map. Full-bleed (preserveAspectRatio=none)
// so the land grid stretches to fill and stays aligned with the markers'
// percentage projection. viewBox units = grid cells.
function WorldDots() {
  return (
    <svg
      className="absolute inset-0 w-full h-full"
      viewBox={`0 0 ${WORLD_COLS} ${WORLD_ROWS}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g fill="var(--text-tertiary)" opacity={0.35}>
        {LAND_CELLS.map(([c, r]) => (
          <circle key={`${c}-${r}`} cx={c + 0.5} cy={r + 0.5} r={0.3} />
        ))}
      </g>
    </svg>
  )
}
