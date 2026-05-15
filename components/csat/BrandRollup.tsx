'use client'

/**
 * Per-brand ratings list. Each row clickable to scope the dashboard
 * to one brand. Unbranded widgets ("(no brand)") are visible but
 * not clickable — there's no brandId to filter by.
 */

import type { CsatResponse } from '@/lib/csat-types'

interface Props {
  byBrand: CsatResponse['byBrand']
  active: string | null
  onToggle: (brandId: string | null) => void
}

export default function BrandRollup({ byBrand, active, onToggle }: Props) {
  if (byBrand.length === 0) return null
  return (
    <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>By brand</h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
        {active ? 'Filtered. Click again to clear.' : 'Click any brand to scope the whole dashboard to it.'}
      </p>
      <div className="space-y-1">
        {byBrand.map(b => {
          const isActive = active === b.brandId
          return (
            <button
              key={b.brandId ?? '∅'}
              onClick={() => b.brandId && onToggle(isActive ? null : b.brandId)}
              disabled={!b.brandId}
              className="w-full flex items-center gap-3 py-2 px-2 rounded transition-colors hover:bg-zinc-900/40 disabled:cursor-default"
              style={isActive ? { background: 'var(--accent-primary-bg)' } : undefined}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: b.color ?? 'var(--surface-tertiary)' }}
              />
              <span className="text-sm flex-1 truncate text-left" style={{ color: isActive ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
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
  )
}
