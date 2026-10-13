'use client'

/**
 * "Set plan" control on the admin workspace page. Lets staff put a
 * workspace on the Growthable plan the customer bought without going
 * through a help-centre install. POSTs to
 * /api/admin/workspaces/[id]/set-plan and refreshes the server render.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GROWTHABLE_PLANS, type GrowthablePlanId } from '@/lib/partner/growthable-plans'

export default function SetPlanControl({
  workspaceId, currentGrowthablePlan,
}: {
  workspaceId: string
  currentGrowthablePlan: GrowthablePlanId | null
}) {
  const router = useRouter()
  const [plan, setPlan] = useState<GrowthablePlanId>(currentGrowthablePlan ?? 'agency_ai')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/set-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ growthablePlan: plan }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Failed to set plan.'); return }
      setDone(true)
      router.refresh()
    } catch {
      setError('Network error — try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <select
        value={plan}
        onChange={e => { setPlan(e.target.value as GrowthablePlanId); setDone(false) }}
        className="rounded px-2 py-1.5 bg-zinc-900 text-zinc-200 border border-zinc-700"
      >
        {GROWTHABLE_PLANS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <button
        onClick={save}
        disabled={busy}
        className="font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black disabled:opacity-50"
      >
        {busy ? 'Saving…' : currentGrowthablePlan ? 'Change plan' : 'Provision plan'}
      </button>
      {done && <span className="text-emerald-400">Plan updated.</span>}
      {error && <span className="text-red-400">{error}</span>}
    </div>
  )
}
