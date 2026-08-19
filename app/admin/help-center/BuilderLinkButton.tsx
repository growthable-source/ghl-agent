'use client'

/**
 * Mints a fresh single-use builder link for the install and opens it in
 * a new tab. Minted per click — the token is consumed on first load, so
 * caching one would leave the second click on "link no longer valid".
 */

import { useState } from 'react'

export default function BuilderLinkButton({ installId }: { installId: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/help-center/${installId}/builder-link`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.builderUrl) { setError(data.error || 'Could not mint a link.'); return }
      window.open(data.builderUrl, '_blank', 'noopener')
    } finally { setBusy(false) }
  }

  return (
    <span>
      <button
        onClick={open}
        disabled={busy}
        className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 disabled:opacity-50"
        title="Opens the customer's embedded widget builder (single-use link, signs in as the install's owner)"
      >
        {busy ? 'Minting…' : 'Widget builder ↗'}
      </button>
      {error && <span className="block text-[10px] text-red-400 mt-1">{error}</span>}
    </span>
  )
}
