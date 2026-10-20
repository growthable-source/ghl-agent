'use client'

/**
 * Shown across the top of a customer's workspace while a super admin is
 * in a support session (lib/support-session.ts), so staff never forget
 * they're acting inside someone else's account. "Exit" ends the session
 * (audit-logged) and returns to the admin workspace page.
 */

import { useState } from 'react'

export default function SupportSessionBanner({ workspaceId, adminEmail }: { workspaceId: string; adminEmail: string }) {
  const [busy, setBusy] = useState(false)

  async function exit() {
    setBusy(true)
    try {
      await fetch('/api/admin/support/exit', { method: 'POST' })
    } finally {
      window.location.href = `/admin/workspaces/${workspaceId}`
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs bg-amber-500 text-black">
      <span>
        <strong>Support mode</strong> — you&apos;re working in a customer&apos;s workspace as {adminEmail}. Changes are live.
      </span>
      <button
        onClick={exit}
        disabled={busy}
        className="font-semibold px-3 py-1 rounded-md bg-black/85 text-white hover:bg-black disabled:opacity-50"
      >
        {busy ? 'Exiting…' : 'Exit support mode'}
      </button>
    </div>
  )
}
