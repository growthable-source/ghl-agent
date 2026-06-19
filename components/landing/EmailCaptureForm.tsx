'use client'

import { useState, type FormEvent } from 'react'

/**
 * Homepage email capture → POST /api/public/marketing-lead.
 * Pulls any utm_* params off the current URL for attribution. Theme-token
 * styled so it follows the light landing palette.
 */
export default function EmailCaptureForm({
  source = 'homepage',
  cta = 'Notify me',
}: {
  source?: string
  cta?: string
}) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || state === 'sending') return
    setState('sending')
    setMsg('')
    try {
      const utm: Record<string, string> = {}
      const sp = new URLSearchParams(window.location.search)
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
        const v = sp.get(k)
        if (v) utm[k] = v
      }
      const res = await fetch('/api/public/marketing-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          source,
          utm: Object.keys(utm).length ? utm : undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        // Fire a Meta Pixel Lead event when a pixel is present on the page
        // (e.g. the /gyms ad landing page). Guarded so it's a no-op on pages
        // without a pixel.
        const w = window as unknown as { fbq?: (...args: unknown[]) => void }
        if (typeof w.fbq === 'function') w.fbq('track', 'Lead')
        setState('done')
        setMsg("You're on the list — we'll be in touch.")
      } else {
        setState('error')
        setMsg(body.error || 'Something went wrong. Please try again.')
      }
    } catch {
      setState('error')
      setMsg('Something went wrong. Please try again.')
    }
  }

  if (state === 'done') {
    return (
      <p className="text-sm font-medium" style={{ color: 'var(--accent-emerald)' }}>
        ✓ {msg}
      </p>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@company.com"
        aria-label="Email address"
        className="flex-1 rounded-lg px-4 py-3 text-sm outline-none"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
      />
      <button type="submit" disabled={state === 'sending'} className="btn-primary shrink-0 disabled:opacity-60">
        {state === 'sending' ? 'Sending…' : cta}
      </button>
      {state === 'error' && (
        <p className="text-xs w-full sm:basis-full" style={{ color: 'var(--accent-red)' }}>
          {msg}
        </p>
      )}
    </form>
  )
}
