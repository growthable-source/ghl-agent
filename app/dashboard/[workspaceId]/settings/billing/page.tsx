'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
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
  const workspaceId = params.workspaceId as string

  const [usage, setUsage] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'annual'>('monthly')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/billing/usage?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(setUsage)
      .catch(console.error)
      .finally(() => setLoading(false))
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
        <p className="text-zinc-500 text-sm">Loading billing...</p>
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
        <Link href={`/dashboard/${workspaceId}/settings`} className="text-zinc-500 hover:text-white text-sm">
          ← Settings
        </Link>
      </div>

      <div className="mb-8">
        <h1 className="text-xl font-semibold mb-1">Billing & Usage</h1>
        <p className="text-zinc-400 text-sm">Manage your plan, view usage, and update payment details.</p>
      </div>

      {/* Trial banner */}
      {usage?.plan === 'trial' && !usage.trialExpired && (
        <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-amber-300">Free Trial</p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              {trialDaysLeft} day{trialDaysLeft !== 1 ? 's' : ''} remaining — full access to all Growth-tier features.
            </p>
          </div>
          <span className="text-xs text-amber-500 bg-amber-900/40 px-2.5 py-1 rounded-full font-medium">
            {trialDaysLeft}d left
          </span>
        </div>
      )}

      {usage?.trialExpired && (
        <div className="rounded-xl border border-red-800/50 bg-red-950/30 p-4 mb-6">
          <p className="text-sm font-medium text-red-300">Trial Expired</p>
          <p className="text-xs text-red-400/70 mt-0.5">
            Your trial has ended. Select a plan below to continue using Voxility.
          </p>
        </div>
      )}

      {/* Current usage */}
      {isOnPaidPlan && usage && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-xs text-zinc-500 font-medium mb-1">Current Plan</p>
            <p className="text-lg font-semibold text-white">{usage.planLabel}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-xs text-zinc-500 font-medium mb-1">Messages This Period</p>
            <p className="text-lg font-semibold text-white">
              {usage.messages.used.toLocaleString()}
              <span className="text-sm text-zinc-500 font-normal"> / {usage.messages.limit.toLocaleString()}</span>
            </p>
            {usage.messages.overage > 0 && (
              <p className="text-xs text-amber-400 mt-1">
                {usage.messages.overage.toLocaleString()} overage — ~${usage.messages.estimatedOverageCost}
              </p>
            )}
            <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (usage.messages.used / usage.messages.limit) * 100)}%`,
                  background: usage.messages.used > usage.messages.limit ? '#f59e0b' : '#fa4d2e',
                }}
              />
            </div>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <p className="text-xs text-zinc-500 font-medium mb-1">Voice Minutes</p>
            <p className="text-lg font-semibold text-white">
              {usage.voice.minutesUsed}
              <span className="text-sm text-zinc-500 font-normal"> / {usage.voice.minuteLimit} min</span>
            </p>
            {usage.voice.overage > 0 && (
              <p className="text-xs text-amber-400 mt-1">
                {usage.voice.overage} min overage — ~${usage.voice.estimatedOverageCost}
              </p>
            )}
            {usage.voice.minuteLimit > 0 && (
              <div className="mt-2 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (usage.voice.minutesUsed / usage.voice.minuteLimit) * 100)}%`,
                    background: usage.voice.minutesUsed > usage.voice.minuteLimit ? '#f59e0b' : '#fa4d2e',
                  }}
                />
              </div>
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
            className="rounded-lg border border-zinc-700 bg-zinc-900 text-white text-sm px-4 py-2 hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            {actionLoading === 'portal' ? 'Opening...' : 'Manage Subscription & Payment'}
          </button>
        </div>
      )}

      {/* Plan selector */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-zinc-200">
            {isOnPaidPlan ? 'Change Plan' : 'Choose a Plan'}
          </h2>
          <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
            <button
              onClick={() => setBillingPeriod('monthly')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                billingPeriod === 'monthly' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingPeriod('annual')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                billingPeriod === 'annual' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-white'
              }`}
            >
              Annual
              <span className="ml-1 text-emerald-400">-17%</span>
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
                className={`rounded-xl border p-5 relative ${
                  plan.popular
                    ? 'border-[#fa4d2e]/40 bg-zinc-950'
                    : 'border-zinc-800 bg-zinc-950'
                } ${isCurrent ? 'ring-1 ring-[#fa4d2e]/50' : ''}`}
              >
                {plan.popular && (
                  <span className="absolute -top-2.5 left-4 text-[10px] font-bold uppercase tracking-wider text-[#fa4d2e] bg-zinc-950 px-2">
                    Most Popular
                  </span>
                )}

                <h3 className="text-base font-semibold text-white mb-1">{plan.label}</h3>
                <p className="text-xs text-zinc-500 mb-3">{plan.description}</p>

                <div className="mb-4">
                  <span className="text-2xl font-bold text-white">${price}</span>
                  <span className="text-xs text-zinc-500">/mo</span>
                  {billingPeriod === 'annual' && (
                    <span className="text-xs text-zinc-600 ml-1 line-through">${plan.monthlyPrice}</span>
                  )}
                </div>

                <ul className="space-y-1.5 mb-5">
                  {plan.highlights.map(h => (
                    <li key={h} className="flex items-center gap-2 text-xs text-zinc-400">
                      <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      {h}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div className="text-center text-xs text-zinc-500 py-2 rounded-lg border border-zinc-800 bg-zinc-900">
                    Current Plan
                  </div>
                ) : (
                  <button
                    onClick={() => isOnPaidPlan ? handleChangePlan(plan.id) : handleCheckout(plan.id)}
                    disabled={actionLoading === plan.id}
                    className={`w-full text-sm font-medium py-2 rounded-lg transition-colors disabled:opacity-50 ${
                      plan.popular
                        ? 'bg-[#fa4d2e] text-white hover:bg-[#e8432a]'
                        : 'bg-white text-black hover:bg-zinc-200'
                    }`}
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

        <p className="text-xs text-zinc-600 mt-4 text-center">
          All plans include a 7-day free trial. Message overage billed at $0.04/message. Voice overage at $0.18/minute.
        </p>
      </div>
    </div>
  )
}
