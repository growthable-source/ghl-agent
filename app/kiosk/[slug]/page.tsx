'use client'

/**
 * Shared-login kiosk landing screen.
 *
 * Built for a shared terminal at a support desk: enter the workspace PIN
 * once, tap your name, enter your own PIN. Three steps, big tap targets,
 * numeric keypads. On success it mints a real operator session and lands
 * in the inbox.
 */

import { useState } from 'react'
import { useParams } from 'next/navigation'

interface Operator { id: string; displayName: string }

const card = { background: 'var(--surface)', borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' } as const

export default function KioskPage() {
  const params = useParams()
  const slug = params.slug as string

  const [step, setStep] = useState<'pin' | 'pick' | 'operatorPin'>('pin')
  const [operators, setOperators] = useState<Operator[]>([])
  const [selected, setSelected] = useState<Operator | null>(null)
  const [workspacePin, setWorkspacePin] = useState('')
  const [operatorPin, setOperatorPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submitWorkspacePin(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/kiosk/${slug}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: workspacePin }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not enter'); return }
      setOperators(data.operators || [])
      setStep('pick')
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  async function submitOperatorPin(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/kiosk/${slug}/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorId: selected.id, pin: operatorPin }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not sign in')
        if (data.code === 'LAUNCHER_REQUIRED') { setStep('pin'); setWorkspacePin('') }
        return
      }
      // Full navigation so middleware picks up the new session cookie.
      window.location.href = data.redirectTo
    } catch {
      setError('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--background)', color: 'var(--text-primary)' }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold mb-1">Operator sign-in</h1>
          <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
            {step === 'pin' && 'Enter the shared team PIN to begin.'}
            {step === 'pick' && 'Tap your name to sign in.'}
            {step === 'operatorPin' && selected && `Enter ${selected.displayName}'s PIN.`}
          </p>
        </div>

        {error && (
          <div className="mb-4 text-sm rounded-lg px-3 py-2 text-center"
            style={{ background: 'var(--accent-red-bg, rgba(220,38,38,0.1))', color: 'var(--accent-red, #f87171)' }}>
            {error}
          </div>
        )}

        {step === 'pin' && (
          <form onSubmit={submitWorkspacePin} className="space-y-3">
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              value={workspacePin}
              onChange={e => setWorkspacePin(e.target.value.replace(/\D/g, ''))}
              placeholder="Team PIN"
              className="w-full h-12 rounded-lg border px-4 text-center text-lg tracking-[0.4em]"
              style={card}
            />
            <button type="submit" disabled={busy || !workspacePin}
              className="w-full h-12 rounded-lg font-medium transition-opacity disabled:opacity-50"
              style={{ background: '#fa4d2e', color: '#fff' }}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'pick' && (
          <div>
            {operators.length === 0 ? (
              <p className="text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
                No operators have been set up yet. Ask an admin to add operators in Settings.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {operators.map(op => (
                  <button key={op.id}
                    onClick={() => { setSelected(op); setOperatorPin(''); setError(null); setStep('operatorPin') }}
                    className="h-20 rounded-xl border flex items-center justify-center text-center px-3 font-medium transition-colors hover:border-[var(--text-tertiary)]"
                    style={card}>
                    {op.displayName}
                  </button>
                ))}
              </div>
            )}
            <button onClick={() => { setStep('pin'); setWorkspacePin(''); setError(null) }}
              className="w-full mt-5 text-sm" style={{ color: 'var(--text-tertiary)' }}>
              ← Back
            </button>
          </div>
        )}

        {step === 'operatorPin' && selected && (
          <form onSubmit={submitOperatorPin} className="space-y-3">
            <input
              autoFocus
              inputMode="numeric"
              pattern="[0-9]*"
              value={operatorPin}
              onChange={e => setOperatorPin(e.target.value.replace(/\D/g, ''))}
              placeholder="Your PIN"
              className="w-full h-12 rounded-lg border px-4 text-center text-lg tracking-[0.4em]"
              style={card}
            />
            <button type="submit" disabled={busy || !operatorPin}
              className="w-full h-12 rounded-lg font-medium transition-opacity disabled:opacity-50"
              style={{ background: '#fa4d2e', color: '#fff' }}>
              {busy ? 'Signing in…' : `Sign in as ${selected.displayName}`}
            </button>
            <button type="button" onClick={() => { setStep('pick'); setError(null) }}
              className="w-full text-sm" style={{ color: 'var(--text-tertiary)' }}>
              ← Choose a different name
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
