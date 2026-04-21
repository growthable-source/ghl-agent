'use client'

import { useEffect, useState } from 'react'

export default function AdminLoginPage() {
  const [phase, setPhase] = useState<'password' | '2fa'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // If this deployment has zero admins, bounce to /admin/setup so the
  // first-time visitor creates an account instead of staring at a
  // login form that can't work.
  useEffect(() => {
    fetch('/api/admin/setup').then(r => r.json()).then(s => {
      if (s.ready && !s.alreadyConfigured) {
        window.location.replace('/admin/setup')
      }
    }).catch(() => {})
  }, [])

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Login failed (${res.status})`)
      }
      const data = await res.json()
      if (data.requires2fa) {
        // Password phase OK; prompt for the TOTP code.
        setPhase('2fa')
        setSubmitting(false)
      } else {
        window.location.href = '/admin'
      }
    } catch (err: any) {
      setError(err.message || 'Login failed')
      setSubmitting(false)
    }
  }

  async function submit2fa(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Invalid code (${res.status})`)
      }
      window.location.href = '/admin'
    } catch (err: any) {
      setError(err.message || 'Invalid code')
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/90">
            Voxility
          </p>
          <h1 className="text-2xl font-semibold mt-1">Admin sign in</h1>
          <p className="text-xs text-zinc-500 mt-1.5">
            For staff only. Customer accounts use the regular{' '}
            <a href="/login" className="text-blue-400 hover:text-blue-300">sign-in page</a>.
          </p>
        </div>

        {phase === 'password' && (
          <form onSubmit={submitPassword} className="space-y-4">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="username"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
              />
            </div>
            {error && <p className="text-xs text-red-400 leading-snug">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {phase === '2fa' && (
          <form onSubmit={submit2fa} className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
              Password accepted — now enter the 6-digit code from your authenticator app.
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Authenticator code</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
                autoFocus
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-center text-lg font-mono tracking-widest text-white focus:outline-none focus:border-zinc-500"
              />
            </div>
            {error && <p className="text-xs text-red-400 leading-snug">{error}</p>}
            <button
              type="submit"
              disabled={submitting || code.length !== 6}
              className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => { setPhase('password'); setCode(''); setError(null) }}
              className="block w-full text-center text-xs text-zinc-500 hover:text-zinc-300"
            >
              Use a different account
            </button>
          </form>
        )}

        <p className="text-[11px] text-zinc-600 text-center mt-6">
          Lost access? Another super-admin can reset your password from{' '}
          <span className="font-mono">/admin/admins</span>.
        </p>
      </div>
    </div>
  )
}
