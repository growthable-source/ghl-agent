/**
 * Self-contained global telemetry map for the portal Overview.
 *
 * Real data only — each marker is a location we actually saw visitors
 * from (Vercel edge geo, aggregated by country). Positions use a plain
 * equirectangular projection over a dotted world surface (matches the
 * design's dotted-map aesthetic, no external map asset / expiring CDN).
 */

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

export default function TelemetryMap({ points }: { points: GeoPoint[] }) {
  if (points.length === 0) {
    return (
      <div className="relative rounded-lg overflow-hidden h-64 flex items-center justify-center text-center px-6" style={{ background: 'var(--surface-secondary)' }}>
        <DotField />
        <div className="relative">
          <p className="text-xs text-zinc-400">No visitor locations yet.</p>
          <p className="text-[10px] text-zinc-600 mt-1">The map lights up as visitors open a chat — location is captured automatically.</p>
        </div>
      </div>
    )
  }

  const max = Math.max(...points.map(p => p.count))
  const top = [...points].sort((a, b) => b.count - a.count)

  return (
    <div className="relative rounded-lg overflow-hidden h-64" style={{ background: 'var(--surface-secondary)' }}>
      <DotField />
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
      <div className="absolute bottom-2 left-3 text-[9px] text-zinc-500">
        {points.length} {points.length === 1 ? 'country' : 'countries'} · {points.reduce((s, p) => s + p.count, 0).toLocaleString()} chats
      </div>
    </div>
  )
}

// Dotted equirectangular surface — purely decorative texture.
function DotField() {
  return (
    <div
      className="absolute inset-0 opacity-[0.18]"
      style={{ backgroundImage: 'radial-gradient(circle, var(--text-tertiary) 1px, transparent 1px)', backgroundSize: '14px 14px' }}
      aria-hidden="true"
    />
  )
}
