'use client'

/**
 * Portal moderation controls for a live chat — end the chat, or end + block
 * the visitor for abusive conduct (which emails the brand's portal admins).
 * Human-gated: nothing here is automatic; the sentiment meter just flags who
 * to look at.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function ConversationModeration({
  conversationId, sentiment, blocked,
}: {
  conversationId: string
  sentiment: 'green' | 'amber' | 'red' | null
  blocked: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<'end' | 'block' | 'unblock' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(action: 'end' | 'block' | 'unblock') {
    if (action === 'block' && !confirm("End this chat and block the visitor for conduct? They won't be able to message on this widget again, and your portal admins will be emailed. You can undo this.")) return
    setBusy(action); setError(null)
    try {
      const res = await fetch(`/api/portal/conversations/${conversationId}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error || 'Something went wrong.'); return }
      router.refresh()
    } finally { setBusy(null) }
  }

  if (blocked) {
    return (
      <div className="space-y-2">
        <p className="text-xs" style={{ color: 'var(--accent-red)' }}>
          Blocked for conduct — messages from this visitor are refused.
        </p>
        <button onClick={() => act('unblock')} disabled={!!busy}
          className="w-full text-xs font-medium px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 disabled:opacity-50">
          {busy === 'unblock' ? 'Unblocking…' : 'Unblock visitor'}
        </button>
        {error && <p className="text-[11px]" style={{ color: 'var(--accent-red)' }}>{error}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sentiment === 'red' && (
        <p className="text-[11px]" style={{ color: 'var(--accent-red)' }}>
          Flagged as hostile/abusive. You can end the chat and block this visitor.
        </p>
      )}
      <button onClick={() => act('block')} disabled={!!busy}
        className="w-full text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-50"
        style={{ background: 'var(--accent-red)', color: '#fff' }}>
        {busy === 'block' ? 'Blocking…' : 'End chat & block for conduct'}
      </button>
      <button onClick={() => act('end')} disabled={!!busy}
        className="w-full text-xs font-medium px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500 disabled:opacity-50">
        {busy === 'end' ? 'Ending…' : 'End chat'}
      </button>
      {error && <p className="text-[11px]" style={{ color: 'var(--accent-red)' }}>{error}</p>}
    </div>
  )
}
