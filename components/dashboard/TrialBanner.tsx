'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Props {
  workspaceId: string
}

export default function TrialBanner({ workspaceId }: Props) {
  const [data, setData] = useState<{
    plan: string
    trialEndsAt: string | null
    trialExpired: boolean
  } | null>(null)

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
          Your trial has expired. Upgrade to continue using Voxility.
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

  return (
    <div
      className="px-4 py-2 flex items-center justify-between border-b"
      style={{ background: 'var(--accent-amber-bg)', borderColor: 'var(--accent-amber)' }}
    >
      <p className="text-xs font-medium" style={{ color: 'var(--accent-amber)' }}>
        Free trial — {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
      </p>
      <Link
        href={`/dashboard/${workspaceId}/settings/billing`}
        className="text-xs font-semibold px-3 py-1 rounded-md transition-opacity hover:opacity-90"
        style={{ background: 'var(--accent-amber)', color: 'var(--btn-primary-text)' }}
      >
        Choose Plan
      </Link>
    </div>
  )
}
