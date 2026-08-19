'use client'

/**
 * "Send onboarding email" for a Help Center install: expands to a
 * comma-separated recipients box (pre-filled with the customer's own
 * address), POSTs, and reports who it reached. The email's links are
 * resolved server-side — this only chooses recipients.
 */

import { useState } from 'react'

export default function OnboardingEmailButton({
  installId, defaultRecipient,
}: {
  installId: string
  defaultRecipient: string
}) {
  const [open, setOpen] = useState(false)
  const [recipients, setRecipients] = useState(defaultRecipient)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/help-center/${installId}/onboarding-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Send failed.'); return }
      const failedNote = data.failed?.length ? ` (${data.failed.length} failed)` : ''
      setDone(`Sent to ${data.sent.length} recipient${data.sent.length === 1 ? '' : 's'}${failedNote}.`)
    } finally { setBusy(false) }
  }

  if (done) return <p className="text-[11px] text-emerald-400 max-w-[220px]">{done}</p>

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] px-2 py-1 rounded border border-sky-500/40 text-sky-300"
        title="Email the customer their help centre, widget and portal links as buttons"
      >
        ✉ Onboarding email…
      </button>
    )
  }

  return (
    <div className="w-[240px] space-y-1.5">
      <textarea
        value={recipients}
        onChange={e => setRecipients(e.target.value)}
        rows={2}
        placeholder="a@x.com, b@y.com"
        className="w-full rounded px-2 py-1.5 text-[11px] bg-zinc-900 text-zinc-200 border border-zinc-700 font-mono resize-y"
      />
      <p className="text-[10px] text-zinc-500">Comma-separated. Each gets their own copy.</p>
      {error && <p className="text-[10px] text-red-400">{error}</p>}
      <div className="flex gap-1.5">
        <button
          onClick={send}
          disabled={busy || !recipients.trim()}
          className="flex-1 text-[11px] font-semibold px-2 py-1 rounded bg-sky-500 text-black disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send'}
        </button>
        <button onClick={() => setOpen(false)} className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-400">
          Cancel
        </button>
      </div>
    </div>
  )
}
