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

  if (data.trialExpired) {
    return (
      <div className="bg-red-950/50 border-b border-red-800/50 px-4 py-2 flex items-center justify-between">
        <p className="text-xs text-red-300">
          Your trial has expired. Upgrade to continue using Voxility.
        </p>
        <Link
          href={`/dashboard/${workspaceId}/settings/billing`}
          className="text-xs font-medium text-red-200 bg-red-900/50 px-3 py-1 rounded-md hover:bg-red-900 transition-colors"
        >
          Upgrade Now
        </Link>
      </div>
    )
  }

  return (
    <div className="bg-amber-950/30 border-b border-amber-800/30 px-4 py-2 flex items-center justify-between">
      <p className="text-xs text-amber-300/80">
        Free trial — {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining
      </p>
      <Link
        href={`/dashboard/${workspaceId}/settings/billing`}
        className="text-xs font-medium text-amber-200 bg-amber-900/30 px-3 py-1 rounded-md hover:bg-amber-900/50 transition-colors"
      >
        Choose Plan
      </Link>
    </div>
  )
}
