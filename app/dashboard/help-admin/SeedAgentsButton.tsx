'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * One-click trigger for the /api/help/seed-agents endpoint.
 * Creates the "Agents" category and every article under it, or updates
 * them in place if they already exist. Idempotent — safe to click twice.
 */
export default function SeedAgentsButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<null | { kind: 'ok' | 'err'; msg: string }>(null)

  async function run() {
    setBusy(true)
    setStatus(null)
    try {
      const res = await fetch('/api/help/seed-agents', { method: 'POST' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `Seed failed (${res.status})`)
      setStatus({
        kind: 'ok',
        msg: `Seeded ${body.totalArticles} articles — ${body.created} created, ${body.updated} updated.`,
      })
      router.refresh()
    } catch (err: any) {
      setStatus({ kind: 'err', msg: err?.message ?? 'Seed failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {status && (
        <span className={`text-xs ${status.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
          {status.msg}
        </span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="inline-flex items-center rounded-lg border border-zinc-700 hover:border-zinc-500 bg-zinc-950 text-zinc-300 hover:text-white text-xs font-medium px-3 h-10 transition-colors disabled:opacity-50"
        title="Seed or reseed the Agents category from lib/help-seed-agents.ts"
      >
        {busy ? 'Seeding…' : 'Seed Agents docs'}
      </button>
    </div>
  )
}
