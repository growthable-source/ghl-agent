'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useBannerDismissal } from '@/lib/use-banner-dismissal'
import BannerDismissMenu from './BannerDismissMenu'

interface Props {
  workspaceId: string
}

export default function TrialBanner({ workspaceId }: Props) {
  const [data, setData] = useState<{
    plan: string
    trialEndsAt: string | null
    trialExpired: boolean
  } | null>(null)

  // Snooze only applies to the "days remaining" reminder. The expired
  // state below is action-required and cannot be dismissed — letting
  // an operator hide "trial expired" forever would just mean their
  // agents silently stay paywalled with no visible reason.
  const { hidden, snooze, dismissForever } = useBannerDismissal('trial-active')

  useEffect(() => {
    fetch(`/api/billing/usage?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => setData({ plan: d.plan, trialEndsAt: d.trialEndsAt, trialExpired: d.trialExpired }))
      .catch(() => {})
  }, [workspaceId])

  if (!data || data.plan !== 'trial') return null

  const daysLeft = data.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0

  // Theme-token-driven colours so the banner reads correctly in both light
  // (cream page) and dark themes. The previous version used raw Tailwind
  // amber-950/300/200 which aren't in globals.css's light-mode override
  // map — text rendered pale on pale on the soft-light theme.
  if (data.trialExpired) {
    return (
      <div
        className="px-4 py-2 flex items-center justify-between border-b"
        style={{ background: 'var(--accent-red-bg)', borderColor: 'var(--accent-red)' }}
      >
        <p className="text-xs font-medium" style={{ color: 'var(--accent-red)' }}>
          Your trial has expired. Upgrade to continue using Xovera.
        </p>
        <Link
          href={`/dashboard/${workspaceId}/settings/billing`}
          className="text-xs font-semibold px-3 py-1 rounded-md transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent-red)', color: 'var(--btn-primary-text)' }}
        >
          Upgrade Now
        </Link>
      </div>
    )
  }

  if (hidden) return null

  return (
    <div
      className="px-4 py-2 flex items-center justify-between gap-3 border-b"
      style={{ background: 'var(--accent-amber-bg)', borderColor: 'var(--accent-amber)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--accent-amber)' }}>
        Free trial — {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href={`/dashboard/${workspaceId}/settings/billing`}
          className="text-xs font-semibold px-3 py-1 rounded-md transition-opacity hover:opacity-90"
          style={{ background: 'var(--accent-amber)', color: 'var(--btn-primary-text)' }}
        >
          Choose Plan
        </Link>
        <BannerDismissMenu
          accentColor="var(--accent-amber)"
          onSnooze={snooze}
          onDismissForever={dismissForever}
        />
      </div>
    </div>
  )
}
