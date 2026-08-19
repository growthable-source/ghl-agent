'use client'

/**
 * Per-row unlock form for the Help Center installs admin page.
 * Collapsed to a button; expands into tier + options; POSTs to
 * /api/admin/help-center/[installId]/unlock and reloads the page so
 * the server-rendered row reflects the new state.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GROWTHABLE_PLANS, type GrowthablePlanId } from '@/lib/partner/growthable-plans'

export default function UnlockControl({
  installId, currentPlan, helpCenterUrl, registered = false,
}: {
  installId: string
  currentPlan: string
  helpCenterUrl: string
  // Register-only rows have no tenant yet — the unlock provisions one
  // first, so the button says what it's really about to do.
  registered?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState<GrowthablePlanId>('agency_ai')
  const [syncArticles, setSyncArticles] = useState(true)
  const [url, setUrl] = useState(helpCenterUrl)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function unlock() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/help-center/${installId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          growthablePlan: plan,
          syncArticles,
          ...(syncArticles && url.trim() ? { helpCenterUrl: url.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Unlock failed.'); return }
      const planLabel = GROWTHABLE_PLANS.find(p => p.id === data.growthablePlan)?.label ?? data.growthablePlan
      const syncNote = data.partnerSynced
        ? ' Widget pushed to their help center.'
        : ' Use "Sync from Xovera" on their help center admin page to surface the widget.'
      setDone(
        data.articleError
          ? `Unlocked on ${planLabel}, but article sync failed: ${data.articleError}${syncNote}`
          : `Unlocked on ${planLabel}.${data.articles ? ' Article crawl queued.' : ''}${syncNote}`,
      )
      setTimeout(() => router.refresh(), 1200)
    } finally { setBusy(false) }
  }

  if (done) return <p className="text-xs text-emerald-400 max-w-[240px]">{done}</p>

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/30"
      >
        {registered ? 'Provision + unlock…' : currentPlan === 'trial' ? 'Unlock…' : 'Change unlock…'}
      </button>
    )
  }

  return (
    <div className="w-[250px] space-y-2 text-xs">
      {/* The GROWTHABLE plan the customer is on — every unlock grants
          the full capability set; this is the commercial record. */}
      <select
        value={plan}
        onChange={e => setPlan(e.target.value as GrowthablePlanId)}
        className="w-full rounded px-2 py-1.5 bg-zinc-900 text-zinc-200 border border-zinc-700"
      >
        {GROWTHABLE_PLANS.map(p => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
        <input type="checkbox" checked={syncArticles} onChange={e => setSyncArticles(e.target.checked)} className="accent-amber-500" />
        Crawl their help center articles
      </label>
      {syncArticles && (
        <input
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://help.theirbusiness.com"
          className="w-full rounded px-2 py-1.5 bg-zinc-900 text-zinc-200 border border-zinc-700 font-mono text-[11px]"
        />
      )}
      {error && <p className="text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={unlock}
          disabled={busy || (syncArticles && !url.trim())}
          className="flex-1 font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black disabled:opacity-50"
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-400">
          Cancel
        </button>
      </div>
    </div>
  )
}
