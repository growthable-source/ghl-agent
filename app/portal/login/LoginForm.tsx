'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function LoginForm({ accent = null }: { accent?: string | null }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/portal/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? 'Sign-in failed')
        setSubmitting(false)
        return
      }
      router.push('/portal')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <span className="block text-sm text-zinc-300 mb-1.5">Email</span>
        <input
          required
          type="email"
          autoFocus
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
        />
      </label>
      <label className="block">
        <span className="block text-sm text-zinc-300 mb-1.5">Password</span>
        <input
          required
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !email || !password}
        className="w-full px-3 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={accent
          ? { background: accent, color: '#fff' }
          : { background: '#fbbf24', color: '#18181b' }}
      >
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
