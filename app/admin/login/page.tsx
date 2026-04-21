'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function submit(e: React.FormEvent) {
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
      // Server set the cookie; a hard reload is cleaner than router.push
      // because it ensures the admin layout re-runs against the new session.
      window.location.href = '/admin'
    } catch (err: any) {
      setError(err.message || 'Login failed')
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

        <form onSubmit={submit} className="space-y-4">
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

          {error && (
            <p className="text-xs text-red-400 leading-snug">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-[11px] text-zinc-600 text-center mt-6">
          Accounts are provisioned via{' '}
          <span className="font-mono">scripts/create-admin.mjs</span>.
          If you need access, ask an existing admin to run it.
        </p>
      </div>
    </div>
  )
}
