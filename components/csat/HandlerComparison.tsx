'use client'

/**
 * AI vs human comparison card. Two clickable "HandlerCard" tiles plus
 * a one-line interpretation of the delta when both sides have data.
 * Clicking a card toggles the handler filter on the parent dashboard.
 */

import type { CsatResponse } from '@/lib/csat-types'

interface Props {
  byHandler: CsatResponse['byHandler']
  active: 'ai' | 'human' | null
  onToggle: (h: 'ai' | 'human' | null) => void
}

export default function HandlerComparison({ byHandler, active, onToggle }: Props) {
  return (
    <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>AI vs human</h2>
      <div className="grid grid-cols-2 gap-3">
        <HandlerCard
          label="AI only"
          helper="No human took over"
          count={byHandler.ai.count}
          avg={byHandler.ai.avg}
          active={active === 'ai'}
          onClick={() => onToggle(active === 'ai' ? null : 'ai')}
        />
        <HandlerCard
          label="Human-touched"
          helper="Operator stepped in"
          count={byHandler.human.count}
          avg={byHandler.human.avg}
          active={active === 'human'}
          onClick={() => onToggle(active === 'human' ? null : 'human')}
        />
      </div>
      {byHandler.ai.count > 0 && byHandler.human.count > 0 && (
        <p className="text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
          Difference: <strong style={{ color: 'var(--text-secondary)' }}>
            {(byHandler.human.avg - byHandler.ai.avg >= 0 ? '+' : '')}
            {(byHandler.human.avg - byHandler.ai.avg).toFixed(2)}
          </strong> for human-touched
          ({byHandler.human.avg > byHandler.ai.avg ? 'humans rate higher' :
            byHandler.human.avg < byHandler.ai.avg ? 'AI rates higher' :
            'tied'})
        </p>
      )}
    </div>
  )
}

function HandlerCard({ label, helper, count, avg, active, onClick }: {
  label: string; helper: string; count: number; avg: number; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg p-4 text-left transition-all border"
      style={active
        ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
        : { borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: active ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}>
        {label}
      </p>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {count > 0 ? avg.toFixed(2) : '—'}
        </span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {count} rating{count === 1 ? '' : 's'}
        </span>
      </div>
      <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>{helper}</p>
    </button>
  )
}
