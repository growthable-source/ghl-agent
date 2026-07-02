'use client'

/**
 * Disconnect button for a widget's agency connection. Confirms, calls
 * the DELETE endpoint (which blanks tokens but preserves the synced
 * locations + their toggles), then reloads the server-rendered page.
 */

import { useState } from 'react'

export default function DisconnectAgencyButton({
  workspaceId,
  widgetId,
  agencyLabel,
}: {
  workspaceId: string
  widgetId: string
  agencyLabel: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function disconnect() {
    const ok = window.confirm(
      `Disconnect ${agencyLabel}?\n\nLocation syncing stops until you reconnect. Your per-location on/off settings are kept and will be restored when you reconnect.`,
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widgets/${widgetId}/locations/connection`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Disconnect failed')
      window.location.reload()
    } catch (e: any) {
      setError(e?.message ?? 'Disconnect failed')
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={disconnect}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-80 disabled:opacity-50"
        style={{ borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
      >
        {busy ? 'Disconnecting…' : 'Disconnect'}
      </button>
      {error && <span className="text-xs" style={{ color: 'var(--accent-red)' }}>{error}</span>}
    </span>
  )
}
