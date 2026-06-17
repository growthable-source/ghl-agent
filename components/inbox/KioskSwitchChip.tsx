'use client'

/**
 * Shown in the inbox header ONLY when the current session is a shared-login
 * kiosk operator. Displays "You are <name>" and a "Switch" action that ends
 * the operator session and returns to the /kiosk/<slug> picker — so the next
 * person on the shared terminal signs in as themselves.
 *
 * Renders nothing for normal email logins (the whoami probe returns
 * isKiosk:false), so it's safe to mount unconditionally.
 */

import { useEffect, useState } from 'react'

interface Whoami { isKiosk: boolean; displayName?: string; slug?: string }

export default function KioskSwitchChip() {
  const [who, setWho] = useState<Whoami | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/kiosk/whoami')
      .then(r => r.json())
      .then(d => { if (alive) setWho(d) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  if (!who?.isKiosk) return null

  async function switchOperator() {
    setBusy(true)
    try {
      await fetch('/api/kiosk/end', { method: 'POST' })
    } catch {
      // Even if the call fails, bounce to the picker — the session cookie
      // either got cleared or the picker will re-auth anyway.
    }
    window.location.href = who?.slug ? `/kiosk/${who.slug}` : '/login'
  }

  return (
    <div className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border"
      style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
      title="You're signed in on a shared terminal">
      <span>You are <strong style={{ color: 'var(--text-primary)' }}>{who.displayName}</strong></span>
      <button onClick={switchOperator} disabled={busy}
        className="font-medium disabled:opacity-50" style={{ color: '#fa4d2e' }}>
        {busy ? '…' : 'Switch'}
      </button>
    </div>
  )
}
