'use client'

/**
 * Active-filter chips bar. Each chip has an × to clear just that
 * filter; "Clear all" wipes them all. Hidden when no filter is on
 * (parent passes the empty-state check, but we render null too as
 * a safety).
 */

import type { CsatResponse } from '@/lib/csat-types'

interface Props {
  rating: number | null
  brandId: string | null
  handler: 'ai' | 'human' | null
  allBrands: CsatResponse['allBrands']
  onClearRating: () => void
  onClearBrand: () => void
  onClearHandler: () => void
  onClearAll: () => void
}

export default function FilterChipBar(p: Props) {
  const hasAny = p.rating !== null || p.brandId !== null || p.handler !== null
  if (!hasAny) return null
  const brand = p.brandId ? p.allBrands.find(b => b.id === p.brandId) : null
  return (
    <div className="mb-4 flex items-center gap-2 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>Filtered by</span>
      {p.rating !== null && (
        <FilterChip onClear={p.onClearRating}>{p.rating}★ only</FilterChip>
      )}
      {p.brandId !== null && (
        <FilterChip onClear={p.onClearBrand} color={brand?.primaryColor ?? undefined}>
          {brand?.name || 'Brand'}
        </FilterChip>
      )}
      {p.handler !== null && (
        <FilterChip onClear={p.onClearHandler}>
          {p.handler === 'ai' ? 'AI-only chats' : 'Human-touched chats'}
        </FilterChip>
      )}
      <button
        onClick={p.onClearAll}
        className="text-[11px] underline ml-1"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Clear all
      </button>
    </div>
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
