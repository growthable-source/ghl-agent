'use client'

/**
 * The three top-of-dashboard scorecards: Average rating, Ratings
 * collected, Response rate. Each shows a trend delta pill computed
 * against the prior window, with a hover-title showing the prior
 * value. Pure presentation — no state, no fetching.
 */

import type { CsatResponse } from '@/lib/csat-types'

interface Delta {
  value: number
  suffix: string
  goodIfPositive: boolean
  priorLabel: string
  format?: 'integer' | 'decimal'
}

export default function Scorecards({ data }: { data: CsatResponse }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <Scorecard
        label="Average rating"
        value={`${data.averageRating.toFixed(2)} / 5`}
        hint={'⭐'.repeat(Math.round(data.averageRating))}
        delta={data.trend.deltaAvg !== null
          ? { value: data.trend.deltaAvg, suffix: '', goodIfPositive: true, priorLabel: `vs ${data.trend.priorAvg?.toFixed(2) ?? '—'} prior ${data.days}d` }
          : null}
      />
      <Scorecard
        label="Ratings collected"
        value={String(data.totalRated)}
        hint={`out of ${data.closedTotal} closed chat${data.closedTotal === 1 ? '' : 's'}`}
        delta={{ value: data.trend.deltaCount, suffix: '', goodIfPositive: true, priorLabel: `vs ${data.trend.priorCount} prior ${data.days}d`, format: 'integer' }}
      />
      <Scorecard
        label="Response rate"
        value={`${Math.round(data.responseRate * 100)}%`}
        hint="of closed chats rated"
        delta={{ value: Math.round(data.trend.deltaResponseRate * 100), suffix: 'pp', goodIfPositive: true, priorLabel: `vs ${Math.round(data.trend.priorResponseRate * 100)}% prior ${data.days}d`, format: 'integer' }}
      />
    </div>
  )
}

function Scorecard({ label, value, hint, delta }: { label: string; value: string; hint?: string; delta?: Delta | null }) {
  const showDelta = delta && delta.value !== 0
  const isGood = delta && ((delta.value > 0) === delta.goodIfPositive)
  const fmt = delta?.format === 'integer'
    ? `${delta.value > 0 ? '+' : ''}${delta.value}`
    : `${delta && delta.value > 0 ? '+' : ''}${delta?.value.toFixed(2) ?? ''}`
  return (
    <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
      <div className="flex items-baseline gap-2 mt-1 flex-wrap">
        <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</p>
        {showDelta && (
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
            title={delta!.priorLabel}
            style={{
              background: isGood ? 'var(--accent-green-bg, rgba(34,197,94,0.15))' : 'var(--accent-red-bg)',
              color: isGood ? 'var(--accent-green, #22c55e)' : 'var(--accent-red)',
            }}
          >
            {fmt}{delta!.suffix}
          </span>
        )}
      </div>
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
      {delta && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{delta.priorLabel}</p>}
    </div>
  )
}
