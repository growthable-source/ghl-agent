'use client'

/**
 * 1★–5★ rating histogram. Each bar is a button — clicking filters
 * the dashboard to that star value, clicking the active bar clears
 * the filter.
 */

import type { CsatResponse } from '@/lib/csat-types'

interface Props {
  distribution: CsatResponse['distribution']
  active: number | null
  onToggle: (rating: number | null) => void
}

export default function DistributionChart({ distribution, active, onToggle }: Props) {
  const maxBar = Math.max(1, ...(['1','2','3','4','5'] as const).map(k => distribution[k]))
  return (
    <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Rating distribution</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>Click a row to drill in to just that rating.</p>
      <div className="space-y-2">
        {(['5','4','3','2','1'] as const).map(k => {
          const count = distribution[k]
          const pct = (count / maxBar) * 100
          const n = Number(k)
          const isTop = n >= 4
          const isActive = active === n
          return (
            <button
              key={k}
              onClick={() => onToggle(isActive ? null : n)}
              className="w-full flex items-center gap-3 px-2 py-1 rounded transition-colors hover:bg-zinc-900/40"
              style={isActive ? { background: 'var(--accent-primary-bg)' } : undefined}
            >
              <div className="w-8 text-xs tabular-nums text-left" style={{ color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>{k}★</div>
              <div className="flex-1 h-5 rounded overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${pct}%`,
                    background: isTop ? 'var(--accent-green, #22c55e)' : n === 3 ? 'var(--accent-amber, #f59e0b)' : 'var(--accent-red, #ef4444)',
                  }}
                />
              </div>
              <div className="w-10 text-xs tabular-nums text-right" style={{ color: 'var(--text-tertiary)' }}>{count}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
