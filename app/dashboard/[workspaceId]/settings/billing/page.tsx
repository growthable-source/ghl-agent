'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'

interface UsageData {
  plan: string
  planLabel: string
  trialEndsAt: string | null
  trialExpired: boolean
  messages: {
    used: number
    limit: number
    overage: number
    overageRate: number
    estimatedOverageCost: number
  }
  voice: {
    minutesUsed: number
    minuteLimit: number
    overage: number
    overageRate: number
    estimatedOverageCost: number
  }
  features: {
    agents: number
    channels: string[]
    voiceEnabled: boolean
    crossDomainInvites: boolean
    leadScoring: boolean
    sentimentDetection: boolean
    customPersona: boolean
    teamMembers: number | string
    workspaces: number
    knowledgeEntries: number
  }
}

const PLANS = [
  {
    id: 'starter',
    label: 'Starter',
    monthlyPrice: 297,
    annualPrice: 247,
    description: 'For small businesses getting started with AI.',
    highlights: ['3 AI agents', '1,500 messages/mo', '3 channels', 'Follow-up sequences'],
  },
  {
    id: 'growth',
    label: 'Growth',
    monthlyPrice: 497,
    annualPrice: 414,
    description: 'For growing teams that need voice and advanced features.',
    highlights: ['5 AI agents', '5,000 messages/mo', 'All 7 channels', 'Voice AI (60 min)', 'Lead scoring', '3 workspaces'],
    popular: true,
  },
  {
    id: 'scale',
    label: 'Scale',
    monthlyPrice: 997,
    annualPrice: 831,
    description: 'For agencies and enterprises managing multiple clients.',
    highlights: ['15 AI agents', '15,000 messages/mo', 'All channels + tools', 'Voice AI (200 min)', '10 workspaces', 'Unlimited team members'],
  },
]

export default function BillingPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const workspaceId = params.workspaceId as string

  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  // Is this workspace internal (Xovera staff)? We ask the server rather
  // than duplicating the allowlist logic client-side — source of truth
  // lives in lib/internal-workspace.ts.
  const [isInternal, setIsInternal] = useState(false)
  // Post-plan-switch success banner (for internal flip). ?internal=1&plan=x
  // is appended by the checkout endpoint on success.
  const internalJustSwitched = searchParams.get('internal') === '1'
  const switchedPlan = searchParams.get('plan')

  useEffect(() => {
    fetch(`/api/billing/usage?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(setUsage)
      .catch(console.error)
      .finally(() => setLoading(false))

    // Check internal status for banners + copy changes.
    fetch(`/api/workspaces/${workspaceId}/internal`)
      .then(r => r.json())
      .then(d => setIsInternal(!!d.internal))
      .catch(() => {})
  }, [workspaceId])

  async function handleCheckout(plan: string) {
    setActionLoading(plan)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, plan, period: billingPeriod }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || 'Failed to create checkout session')
      }
    } catch {
      alert('Something went wrong')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleChangePlan(plan: string) {
    setActionLoading(plan)
    try {
      const res = await fetch('/api/billing/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, plan, period: billingPeriod }),
      })
      const data = await res.json()
      if (data.success) {
        window.location.reload()
      } else {
        alert(data.error || 'Failed to change plan')
      }
    } catch {
      alert('Something went wrong')
    } finally {
      setActionLoading(null)
    }
  }

  async function handlePortal() {
    setActionLoading('portal')
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })
      const data = await res.json()
      if (data.url) {
        window.location.href = data.url
      } else {
        alert(data.error || 'Failed to open billing portal')
      }
    } catch {
      alert('Something went wrong')
    } finally {
      setActionLoading(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading billing...</p>
      </div>
    )
  }

  const isOnPaidPlan = usage && !['trial'].includes(usage.plan)
  const trialDaysLeft = usage?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(usage.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6 flex items-center gap-3">
        <Link href={`/dashboard/${workspaceId}/settings`} className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          ← Settings
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-xl font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Billing & Usage</h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Manage your plan, view usage, and update payment details.</p>
      </div>

      {/* Internal-workspace banner. Replaces the trial / trial-expired
          banners for Xovera staff workspaces. */}
      {isInternal && (
        <div
          className="rounded-xl border p-4 mb-6 flex items-center justify-between"
          style={{ borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }}
        >
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--accent-emerald)' }}>Internal workspace</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--accent-emerald)', opacity: 0.85 }}>
              No billing required. Pick any plan below to apply its feature set instantly — no card, no Stripe.
            </p>
          </div>
          <span
            className="text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{ background: 'var(--accent-emerald)', color: 'var(--btn-primary-text)' }}
          >
            {usage?.planLabel ?? usage?.plan ?? 'trial'}
          </span>
        </div>
      )}

      {internalJustSwitched && switchedPlan && (
        <div
          className="rounded-xl border p-4 mb-6 text-sm font-medium"
          style={{
            borderColor: 'var(--accent-emerald)',
            background: 'var(--accent-emerald-bg)',
            color: 'var(--accent-emerald)',
          }}
        >
          ✓ Plan set to <span className="font-semibold capitalize">{switchedPlan}</span>. No billing was triggered — internal workspace.
        </div>
      )}

      {/* Trial banner — hidden for internal workspaces */}
      {!isInternal && usage?.plan === 'trial' && !usage.trialExpired && (
        <div
          className="rounded-xl border p-4 mb-6 flex items-center justify-between"
          style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}
        >
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--accent-amber)' }}>Free Trial</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--accent-amber)', opacity: 0.85 }}>
              {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining — full access to all Growth-tier features.
            </p>
          </div>
          <span
            className="text-xs px-2.5 py-1 rounded-full font-semibold"
            style={{ background: 'var(--accent-amber)', color: 'var(--btn-primary-text)' }}
          >
            {trialDaysLeft}d left
          </span>
        </div>
      )}

      {!isInternal && usage?.trialExpired && (
        <div
          className="rounded-xl border p-4 mb-6"
          style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--accent-red)' }}>Trial Expired</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--accent-red)', opacity: 0.85 }}>
            Your trial has ended. Select a plan below to continue using Xovera.
          </p>
        </div>
      )}

      {/* Current usage */}
      {isOnPaidPlan && usage && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>Current Plan</p>
            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{usage.planLabel}</p>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>Messages This Period</p>
            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {usage.messages.used.toLocaleString()}
              <span className="text-sm font-normal" style={{ color: 'var(--text-tertiary)' }}> / {usage.messages.limit.toLocaleString()}</span>
            </p>
            {usage.messages.overage > 0 && (
              <p className="text-xs text-amber-500 mt-1">
                {usage.messages.overage.toLocaleString()} overage — ~${usage.messages.estimatedOverageCost}
              </p>
            )}
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (usage.messages.used / usage.messages.limit) * 100)}%`,
                  background: usage.messages.used > usage.messages.limit ? '#f59e0b' : '#fa4d2e',
                }}
              />
            </div>
          </div>
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-tertiary)' }}>Voice Minutes</p>
            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {usage.voice.minutesUsed}
              <span className="text-sm font-normal" style={{ color: 'var(--text-tertiary)' }}> / {usage.voice.minuteLimit} min</span>
            </p>
            {usage.voice.overage > 0 && (
              <p className="text-xs text-amber-500 mt-1">
                Over limit — calls are paused. Upgrade to resume.
              </p>
            )}
            {usage.voice.minuteLimit > 0 && (
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (usage.voice.minutesUsed / usage.voice.minuteLimit) * 100)}%`,
                    background: usage.voice.minutesUsed >= usage.voice.minuteLimit
                      ? '#ef4444'
                      : usage.voice.minutesUsed >= usage.voice.minuteLimit * 0.8
                        ? '#f59e0b'
                        : '#fa4d2e',
                  }}
                />
              </div>
            )}
            {usage.voice.minuteLimit === 0 && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Voice calls aren&apos;t included on this plan. Upgrade to enable inbound and outbound calling.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Manage subscription button for paid plans */}
      {isOnPaidPlan && (
        <div className="mb-8">
          <button
            onClick={handlePortal}
            disabled={actionLoading === 'portal'}
            className="rounded-lg border text-sm px-4 py-2 transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)', color: 'var(--text-primary)' }}
          >
            {actionLoading === 'portal' ? 'Opening...' : 'Manage Subscription & Payment'}
          </button>
        </div>
      )}

      {/* Plan selector */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {isOnPaidPlan ? 'Change Plan' : 'Choose a Plan'}
          </h2>
          <div className="flex items-center gap-1 rounded-lg p-0.5 border" style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}>
            <button
              onClick={() => setBillingPeriod('monthly')}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={billingPeriod === 'monthly'
                ? { background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }
                : { color: 'var(--text-tertiary)' }}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod('annual')}
              className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={billingPeriod === 'annual'
                ? { background: 'var(--surface-tertiary)', color: 'var(--text-primary)' }
                : { color: 'var(--text-tertiary)' }}
            >
              Annual
              <span className="ml-1 text-emerald-500">-17%</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLANS.map(plan => {
            const isCurrent = usage?.plan === plan.id
            const price = billingPeriod === 'annual' ? plan.annualPrice : plan.monthlyPrice

            return (
              <div
                key={plan.id}
                className={`rounded-xl border p-5 relative ${isCurrent ? 'ring-1 ring-[#fa4d2e]/50' : ''}`}
                style={{
                  borderColor: plan.popular ? 'rgba(250, 77, 46, 0.4)' : 'var(--border)',
                  background: 'var(--surface)',
                }}
              >
                {plan.popular && (
                  <span className="absolute -top-2.5 left-4 text-[10px] font-bold uppercase tracking-wider text-[#fa4d2e] px-2" style={{ background: 'var(--surface)' }}>
                    Most Popular
                  </span>
                )}

                <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{plan.label}</h3>
                <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>{plan.description}</p>

                <div className="mb-4">
                  <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>${price}</span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>/mo</span>
                  {billingPeriod === 'annual' && (
                    <span className="text-xs ml-1 line-through" style={{ color: 'var(--text-muted)' }}>${plan.monthlyPrice}</span>
                  )}
                </div>

                <ul className="space-y-1.5 mb-5">
                  {plan.highlights.map(h => (
                    <li key={h} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {h}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div className="text-center text-xs py-2 rounded-lg border" style={{ color: 'var(--text-tertiary)', borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}>
                    Current Plan
                  </div>
                ) : (
                  <button
                    onClick={() => isOnPaidPlan ? handleChangePlan(plan.id) : handleCheckout(plan.id)}
                    disabled={actionLoading === plan.id}
                    className="w-full text-sm font-medium py-2 rounded-lg transition-colors hover:opacity-90 disabled:opacity-50"
                    style={plan.popular
                      ? { background: '#fa4d2e', color: '#fff' }
                      : { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                  >
                    {actionLoading === plan.id
                      ? 'Processing...'
                      : isOnPaidPlan
                        ? 'Switch to ' + plan.label
                        : 'Start with ' + plan.label}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-xs mt-4 text-center" style={{ color: 'var(--text-muted)' }}>
          All plans include a 7-day free trial. Message overage billed at $0.04/message. Voice overage at $0.18/minute.
        </p>
      </div>
    </div>
  )
}
