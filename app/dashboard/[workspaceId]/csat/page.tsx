'use client'

/**
 * Visitor satisfaction dashboard.
 *
 * Pure orchestration — every section below renders as its own
 * component under components/csat/. This page owns the filter +
 * date-range state, builds the queryString, fetches once, and
 * passes slices of the response into each child.
 *
 * Drill-down model: every interactive section calls a setter that
 * updates the query string, which re-fetches and re-renders every
 * other section under the new filter. One source of truth (the
 * server response under the active filters); the UI is a fan-out.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import type { CsatResponse } from '@/lib/csat-types'
import EmailReportModal from '@/components/csat/EmailReportModal'
import DateRangePicker, { todayISO, daysAgoISO } from '@/components/csat/DateRangePicker'
import FilterChipBar from '@/components/csat/FilterChipBar'
import Scorecards from '@/components/csat/Scorecards'
import HandlerComparison from '@/components/csat/HandlerComparison'
import DistributionChart from '@/components/csat/DistributionChart'
import BrandRollup from '@/components/csat/BrandRollup'
import AgentRollup from '@/components/csat/AgentRollup'
import OperatorRollup from '@/components/csat/OperatorRollup'
import CommentHighlights from '@/components/csat/CommentHighlights'
import RecentRatings from '@/components/csat/RecentRatings'

export default function CsatPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  // Date window. mode='preset' uses one of the trailing-days buckets
  // (7/30/90); mode='custom' uses explicit from/to dates. Two-mode
  // state lets the operator flip back to a preset without losing the
  // typed custom range.
  const [mode, setMode] = useState<'preset' | 'custom'>('preset')
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const [customFrom, setCustomFrom] = useState<string>(daysAgoISO(30))
  const [customTo, setCustomTo] = useState<string>(todayISO())

  // Drill-down filters — set by clicking bars/cards/rows in the
  // sections below. Each filter rides through to /csat as a query
  // param, so every aggregate recomputes server-side under it.
  const [brandId, setBrandId] = useState<string | null>(null)
  const [rating, setRating] = useState<number | null>(null)
  const [handler, setHandler] = useState<'ai' | 'human' | null>(null)

  const [data, setData] = useState<CsatResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [emailModalOpen, setEmailModalOpen] = useState(false)

  const queryString = useMemo(() => {
    const q = new URLSearchParams()
    if (mode === 'custom') {
      q.set('from', customFrom)
      q.set('to', customTo)
    } else {
      q.set('days', String(days))
    }
    if (brandId) q.set('brandId', brandId)
    if (rating) q.set('rating', String(rating))
    if (handler) q.set('handler', handler)
    return q.toString()
  }, [mode, days, customFrom, customTo, brandId, rating, handler])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/csat?${queryString}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, queryString])

  const hasFilter = brandId !== null || rating !== null || handler !== null
  const clearFilters = useCallback(() => { setBrandId(null); setRating(null); setHandler(null) }, [])
  const printUrl = `/dashboard/${workspaceId}/csat/report?${queryString}`

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Visitor satisfaction</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Click any bar, brand, or handler pill to drill in. Reset filters with the chip&nbsp;×.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={printUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-2 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              📄 Print / PDF
            </a>
            <button
              onClick={() => setEmailModalOpen(true)}
              className="text-xs font-semibold px-3 py-2 rounded-lg border transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
            >
              📧 Email report
            </button>
            <DateRangePicker
              mode={mode}
              days={days}
              customFrom={customFrom}
              customTo={customTo}
              onPreset={d => { setMode('preset'); setDays(d) }}
              onToggleCustom={() => setMode(mode === 'custom' ? 'preset' : 'custom')}
              onCustomFrom={setCustomFrom}
              onCustomTo={setCustomTo}
            />
          </div>
        </div>

        <FilterChipBar
          rating={rating}
          brandId={brandId}
          handler={handler}
          allBrands={data?.allBrands ?? []}
          onClearRating={() => setRating(null)}
          onClearBrand={() => setBrandId(null)}
          onClearHandler={() => setHandler(null)}
          onClearAll={clearFilters}
        />

        {data?.notMigrated && (
          <div className="p-4 mb-6 rounded-xl" style={{ background: 'var(--accent-amber-bg)', border: '1px solid var(--accent-amber-bg)' }}>
            <p className="text-sm" style={{ color: 'var(--accent-amber)' }}>{data.error}</p>
          </div>
        )}

        {loading ? (
          <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading ratings…</div>
        ) : !data || data.totalRated === 0 ? (
          <EmptyState days={days} hasFilter={hasFilter} />
        ) : (
          <>
            <Scorecards data={data} />
            <HandlerComparison
              byHandler={data.byHandler}
              active={handler}
              onToggle={setHandler}
            />
            <DistributionChart
              distribution={data.distribution}
              active={rating}
              onToggle={setRating}
            />
            <BrandRollup byBrand={data.byBrand} active={brandId} onToggle={setBrandId} />
            <AgentRollup byAgent={data.byAgent} workspaceId={workspaceId} />
            <OperatorRollup byOperator={data.byOperator} />
            <CommentHighlights highlights={data.commentHighlights} workspaceId={workspaceId} />
            <RecentRatings recent={data.recent} workspaceId={workspaceId} />
          </>
        )}
      </div>

      {emailModalOpen && (
        <EmailReportModal
          workspaceId={workspaceId}
          queryString={queryString}
          onClose={() => setEmailModalOpen(false)}
        />
      )}
    </div>
  )
}

function EmptyState({ days, hasFilter }: { days: number; hasFilter: boolean }) {
  return (
    <div className="rounded-xl border p-10 text-center" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="text-3xl mb-2">⭐</div>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
        {hasFilter ? 'No ratings match these filters' : `No ratings yet in the last ${days} days`}
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
        {hasFilter
          ? 'Try clearing one of the filters above.'
          : 'Ratings appear when visitors tap the stars after a chat ends.'}
      </p>
    </div>
  )
}
