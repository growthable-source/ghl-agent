'use client'

import { useState } from 'react'
import Link from 'next/link'

/**
 * Reusable upgrade-CTA banner for any "plan limit reached" or
 * "trial expired" response from a plan-gated API endpoint.
 *
 * The companion API surfaces these fields:
 *   { error, code, currentPlan, recommendedPlan,
 *     recommendedPlanLabel, recommendedPlanPrice, benefit }
 *
 * Drop in like:
 *   <PlanLimitNotice workspaceId={ws} data={errorData} />
 *
 * Provides:
 *   - The reason the action was blocked
 *   - The recommended plan + price + headline benefit
 *   - One-click "Upgrade to X" button (Stripe Checkout)
 *   - "Compare all plans →" fallback to the billing page
 */

export interface PlanLimitData {
  error: string
  code: 'WIDGET_LIMIT' | 'AGENT_LIMIT' | 'MEMBER_LIMIT' | 'TRIAL_EXPIRED' | string
  currentPlan?: string | null
  recommendedPlan?: string | null
  recommendedPlanLabel?: string | null
  recommendedPlanPrice?: number | null
  benefit?: string | null
}

const PLAN_LIMIT_CODES = new Set(['WIDGET_LIMIT', 'AGENT_LIMIT', 'MEMBER_LIMIT', 'TRIAL_EXPIRED'])

export function isPlanLimitError(data: any): data is PlanLimitData {
  return !!data && typeof data === 'object' && PLAN_LIMIT_CODES.has(data.code)
}

export default function PlanLimitNotice({
  workspaceId, data,
}: {
  workspaceId: string
  data: PlanLimitData
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const billingHref = `/dashboard/${workspaceId}/settings/billing`
  const hasRecommendation = !!data.recommendedPlan && !!data.recommendedPlanLabel

  async function upgrade() {
    if (!data.recommendedPlan) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          plan: data.recommendedPlan,
          period: 'monthly',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Internal-workspace bypass returns ok with the plan already swapped
        // and points the user back to billing — fall back to the link.
        setError(body.error || 'Could not start checkout — opening the billing page instead.')
        setTimeout(() => { window.location.href = billingHref }, 800)
        return
      }
      if (body.url) {
        window.location.href = body.url
      } else if (body.internal) {
        window.location.href = billingHref
      } else {
        window.location.href = billingHref
      }
    } catch (err: any) {
      setError(err?.message || 'Network error — opening billing page')
      setTimeout(() => { window.location.href = billingHref }, 800)
    } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-orange-500/40 bg-gradient-to-br from-orange-500/10 to-orange-500/5 p-4">
      <div className="flex items-start gap-3 mb-3">
        <span className="text-2xl leading-none">✨</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">
            {data.code === 'TRIAL_EXPIRED' ? 'Your trial has ended' : data.error}
          </p>
          {hasRecommendation && (
            <p className="text-xs text-zinc-300 mt-0.5">
              {data.benefit || 'More room to grow'} on the{' '}
              <strong className="text-white">{data.recommendedPlanLabel}</strong> plan
              {typeof data.recommendedPlanPrice === 'number' && data.recommendedPlanPrice > 0 && (
                <span className="text-zinc-400"> — ${data.recommendedPlanPrice}/mo</span>
              )}
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-2 p-2 rounded border border-red-500/30 bg-red-500/5 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        {hasRecommendation && (
          <button
            onClick={upgrade}
            disabled={busy}
            className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            style={{ background: '#fa4d2e' }}
          >
            {busy ? 'Starting checkout…' : `Upgrade to ${data.recommendedPlanLabel} →`}
          </button>
        )}
        <Link
          href={billingHref}
          className="text-xs font-medium px-3 py-2 rounded-lg text-zinc-300 border border-zinc-700 hover:text-white hover:border-zinc-500 transition-colors"
        >
          Compare all plans
        </Link>
      </div>
    </div>
  )
}
