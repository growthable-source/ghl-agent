'use client'

import { useState } from 'react'

/** Two steps: email → 6-digit code. See app/api/sign-in/*. */
export default function SignInForm({ accent, buttonText, callbackUrl, initialEmail }: {
  accent: string
  /** Inline so no global button style can override it. */
  buttonText: string
  callbackUrl: string | null
  initialEmail: string
}) {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  }

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const { ok, data } = await post('/api/sign-in/request-code', { email })
      if (!ok) { setError(data.error || 'Could not send a code.'); return }
      setStep('code')
      setCode('')
      setNotice(`If ${email.trim()} is on the team, a 6-digit code is on its way. It expires in 10 minutes.`)
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { ok, data } = await post('/api/sign-in/verify', { email, code, callbackUrl })
      if (!ok) { setError(data.error || 'Could not sign you in.'); return }
      window.location.assign(data.redirectTo)
    } catch {
      setError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2'
  const inputStyle = { border: '1px solid #d4d4d8', background: '#ffffff', color: '#18181b' }
  const button = 'w-full rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60'

  if (step === 'email') {
    return (
      <form onSubmit={sendCode} className="space-y-4">
        <label className="block">
          <span className="block text-sm font-medium mb-1.5" style={{ color: '#3f3f46' }}>Work email</span>
          <input type="email" required autoFocus autoComplete="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@company.com" className={input} style={inputStyle} />
        </label>
        {error && <p className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
        <button type="submit" disabled={busy || !email.trim()} className={button} style={{ background: accent, color: buttonText }}>
          {busy ? 'Sending…' : 'Email me a sign-in code'}
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={verify} className="space-y-4">
      {notice && <p className="text-sm" style={{ color: '#52525b' }}>{notice}</p>}
      <label className="block">
        <span className="block text-sm font-medium mb-1.5" style={{ color: '#3f3f46' }}>Sign-in code</span>
        <input inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code}
          onChange={e => setCode(e.target.value.replace(/[^\d ]/g, '').slice(0, 7))}
          placeholder="123456" className={`${input} tracking-[0.3em] font-mono text-center text-lg`} style={inputStyle} />
      </label>
      {error && <p className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
      <button type="submit" disabled={busy || code.replace(/\D/g, '').length !== 6} className={button} style={{ background: accent, color: buttonText }}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <div className="flex justify-between text-xs" style={{ color: '#71717a' }}>
        <button type="button" className="underline" onClick={() => { setStep('email'); setError(null); setNotice(null) }}>
          Use a different email
        </button>
        <button type="button" className="underline" disabled={busy} onClick={() => void sendCode()}>
          Send a new code
        </button>
      </div>
    </form>
  )
}
