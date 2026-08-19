'use client'

/**
 * Per-row unlock form for the Help Center installs admin page.
 * Collapsed to a button; expands into tier + options; POSTs to
 * /api/admin/help-center/[installId]/unlock and reloads the page so
 * the server-rendered row reflects the new state.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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
  const [plan, setPlan] = useState<'starter' | 'growth' | 'scale'>('scale')
  const [enableTicketing, setEnableTicketing] = useState(true)
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
          plan,
          enableTicketing: plan === 'scale' && enableTicketing,
          syncArticles,
          ...(syncArticles && url.trim() ? { helpCenterUrl: url.trim() } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Unlock failed.'); return }
      setDone(
        data.articleError
          ? `Unlocked to ${data.plan}, but article sync failed: ${data.articleError}`
          : `Unlocked to ${data.plan}.${data.articles ? ' Article crawl queued.' : ''}`,
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
      <select
        value={plan}
        onChange={e => setPlan(e.target.value as typeof plan)}
        className="w-full rounded px-2 py-1.5 bg-zinc-900 text-zinc-200 border border-zinc-700"
      >
        <option value="starter">Starter — handoff + 2 seats</option>
        <option value="growth">Growth — handoff + 5 seats</option>
        <option value="scale">Scale — everything + ticketing</option>
      </select>
      {plan === 'scale' && (
        <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={enableTicketing} onChange={e => setEnableTicketing(e.target.checked)} className="accent-amber-500" />
          Enable ticketing
        </label>
      )}
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
