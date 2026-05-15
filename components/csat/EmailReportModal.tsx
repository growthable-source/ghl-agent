'use client'

/**
 * Send-this-CSAT-report-as-an-email modal.
 *
 * Posts to /api/workspaces/:id/csat/email with the page's current
 * queryString — so whatever filters the operator has active (brand,
 * rating, handler, date range) ride through to the rendered email.
 */

import { useState } from 'react'

interface Props {
  workspaceId: string
  /** The same querystring the dashboard uses for /csat — keeps the
   *  email body scoped to the active filter set. */
  queryString: string
  onClose: () => void
}

export default function EmailReportModal({ workspaceId, queryString, onClose }: Props) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function send() {
    if (!email.includes('@')) {
      setResult({ ok: false, message: 'Enter a valid email address.' })
      return
    }
    setSending(true)
    setResult(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/csat/email?${queryString}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setResult({ ok: false, message: data.error || 'Failed to send.' })
      } else {
        setResult({ ok: true, message: `Sent to ${email}.` })
      }
    } finally { setSending(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-2xl max-w-md w-full p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Email this report</h2>
        <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
          Sends the CSAT report (with current filters applied) as a readable HTML email.
        </p>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="recipient@example.com"
          autoFocus
          className="w-full rounded-lg px-3 py-2 text-sm mb-3"
          style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
        />
        {result && (
          <p className="text-xs mb-3" style={{ color: result.ok ? 'var(--accent-emerald)' : 'var(--accent-red)' }}>
            {result.message}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-xs px-3 py-2" style={{ color: 'var(--text-tertiary)' }}>Cancel</button>
          <button
            onClick={send}
            disabled={sending || !email}
            className="text-xs font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
