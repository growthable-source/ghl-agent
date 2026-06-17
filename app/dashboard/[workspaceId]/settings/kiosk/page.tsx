'use client'

/**
 * Shared-login kiosk operators settings.
 *
 * Lets an admin run multiple live-chat operators off one shared terminal:
 * generate a shared team PIN, add operator identities (each gets its own
 * PIN), and hand out the /kiosk/<slug> link. Each operator is a real
 * workspace member under the hood, so routing/presence/attribution all
 * work normally — they just sign in by name + PIN instead of email.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import NewBadge from '@/components/NewBadge'

interface OperatorRow {
  id: string
  displayName: string
  disabled: boolean
  locked: boolean
  available: boolean | null
}
interface KioskStatus {
  slug: string | null
  credential: { configured: boolean; lastFour?: string | null; disabled?: boolean }
  operators: OperatorRow[]
  migrationPending?: boolean
}

const inputStyle = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' } as const

export default function KioskSettingsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [status, setStatus] = useState<KioskStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  // One-time PIN reveals, keyed by a label.
  const [reveal, setReveal] = useState<{ label: string; pin: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/kiosk`)
    const data = await res.json()
    setStatus(data)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  async function call(url: string, method: string, body?: any): Promise<any | null> {
    setBusy(true); setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Something went wrong.'); return null }
      return data
    } finally {
      setBusy(false)
    }
  }

  async function rotatePin() {
    const data = await call(`/api/workspaces/${workspaceId}/kiosk/credential`, 'POST')
    if (data?.pin) setReveal({ label: 'Shared team PIN', pin: data.pin })
    await load()
  }
  async function disablePin() {
    if (!confirm('Disable the shared PIN? Operators will not be able to sign in until you generate a new one.')) return
    await call(`/api/workspaces/${workspaceId}/kiosk/credential`, 'DELETE')
    await load()
  }
  async function addOperator() {
    const name = newName.trim()
    if (!name) return
    const data = await call(`/api/workspaces/${workspaceId}/kiosk/operators`, 'POST', { displayName: name })
    if (data?.pin) setReveal({ label: `${name}'s PIN`, pin: data.pin })
    setNewName('')
    await load()
  }
  async function resetOperatorPin(op: OperatorRow) {
    const data = await call(`/api/workspaces/${workspaceId}/kiosk/operators/${op.id}`, 'PATCH', { action: 'reset_pin' })
    if (data?.pin) setReveal({ label: `${op.displayName}'s new PIN`, pin: data.pin })
    await load()
  }
  async function toggleOperator(op: OperatorRow) {
    await call(`/api/workspaces/${workspaceId}/kiosk/operators/${op.id}`, 'PATCH', { action: op.disabled ? 'enable' : 'disable' })
    await load()
  }
  async function removeOperator(op: OperatorRow) {
    if (!confirm(`Remove ${op.displayName}? Their past replies stay attributed, but they can no longer sign in.`)) return
    await call(`/api/workspaces/${workspaceId}/kiosk/operators/${op.id}`, 'DELETE')
    await load()
  }

  if (loading || !status) {
    return <div className="p-8 max-w-2xl"><div className="h-40 rounded-xl animate-pulse" style={{ background: 'var(--surface)' }} /></div>
  }

  const kioskUrl = status.slug
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/kiosk/${status.slug}`
    : null

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>
        Shared-login operators <NewBadge since="2026-06-17" className="ml-1" />
      </h1>
      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Run several live-chat operators from one shared terminal — no separate email logins. Set a shared team PIN,
        add operators (each gets their own PIN), and they sign in by tapping their name. Each operator handles chats,
        toggles Available/Away, and is attributed individually, exactly like a normal teammate.
      </p>

      {status.migrationPending && (
        <div className="mb-4 text-sm rounded-lg px-3 py-2" style={{ background: 'var(--surface)', color: 'var(--text-tertiary)' }}>
          Migration pending — run <code>prisma/migrations/20260617140000_kiosk_shared_login/migration.sql</code> to enable this.
        </div>
      )}
      {error && (
        <div className="mb-4 text-sm rounded-lg px-3 py-2" style={{ background: 'rgba(220,38,38,0.1)', color: '#f87171' }}>{error}</div>
      )}
      {reveal && (
        <div className="mb-4 rounded-lg px-4 py-3 flex items-center justify-between" style={{ background: 'rgba(250,77,46,0.1)', border: '1px solid rgba(250,77,46,0.3)' }}>
          <div>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{reveal.label} — shown once, copy it now</p>
            <p className="text-2xl font-mono font-bold tracking-[0.3em]" style={{ color: '#fa4d2e' }}>{reveal.pin}</p>
          </div>
          <button onClick={() => setReveal(null)} className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Dismiss</button>
        </div>
      )}

      {/* Shared PIN */}
      <div className="rounded-xl border p-5 mb-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Shared team PIN</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {status.credential.configured
                ? status.credential.disabled
                  ? 'Disabled — generate a new one to re-enable kiosk sign-in.'
                  : `Active${status.credential.lastFour ? ` ·  •••• ${status.credential.lastFour}` : ''}`
                : 'Not set up yet.'}
            </p>
          </div>
          <div className="flex gap-2">
            {status.credential.configured && !status.credential.disabled && (
              <button onClick={disablePin} disabled={busy}
                className="text-sm px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                Disable
              </button>
            )}
            <button onClick={rotatePin} disabled={busy}
              className="text-sm px-3 py-1.5 rounded-lg font-medium" style={{ background: '#fa4d2e', color: '#fff' }}>
              {status.credential.configured ? 'Regenerate' : 'Generate PIN'}
            </button>
          </div>
        </div>
        {kioskUrl && (
          <p className="text-xs mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
            Operators sign in at <code style={{ color: 'var(--text-secondary)' }}>{kioskUrl}</code>
          </p>
        )}
      </div>

      {/* Operators */}
      <div className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Operators</p>

        <div className="flex gap-2 mb-4">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addOperator() }}
            placeholder="Operator name (e.g. Dan)"
            className="flex-1 rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button onClick={addOperator} disabled={busy || !newName.trim()}
            className="text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50" style={{ background: '#fa4d2e', color: '#fff' }}>
            Add
          </button>
        </div>

        {status.operators.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No operators yet. Add one above.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {status.operators.map(op => (
              <li key={op.id} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: op.disabled ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                    {op.displayName}
                  </span>
                  {op.disabled && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--input-bg)', color: 'var(--text-tertiary)' }}>Disabled</span>}
                  {op.locked && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(220,38,38,0.12)', color: '#f87171' }}>Locked</span>}
                  {!op.disabled && op.available === true && <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34d399' }} title="Available" />}
                </div>
                <div className="flex gap-3 text-xs">
                  <button onClick={() => resetOperatorPin(op)} disabled={busy} style={{ color: 'var(--text-secondary)' }}>Reset PIN</button>
                  <button onClick={() => toggleOperator(op)} disabled={busy} style={{ color: 'var(--text-secondary)' }}>{op.disabled ? 'Enable' : 'Disable'}</button>
                  <button onClick={() => removeOperator(op)} disabled={busy} style={{ color: '#f87171' }}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
