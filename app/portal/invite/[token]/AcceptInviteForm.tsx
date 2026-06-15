'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 10) {
      setError('Password must be at least 10 characters.')
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/portal/invite/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, name }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? 'Failed to accept invitation')
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
        <span className="block text-sm text-zinc-300 mb-1.5">Your name (optional)</span>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-[var(--portal-accent)] outline-none"
        />
      </label>
      <label className="block">
        <span className="block text-sm text-zinc-300 mb-1.5">Password</span>
        <input
          required
          type="password"
          autoFocus
          value={password}
          onChange={e => setPassword(e.target.value)}
          minLength={10}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-[var(--portal-accent)] outline-none"
        />
        <span className="block text-xs text-zinc-500 mt-1">At least 10 characters.</span>
      </label>
      <label className="block">
        <span className="block text-sm text-zinc-300 mb-1.5">Confirm password</span>
        <input
          required
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          minLength={10}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-[var(--portal-accent)] outline-none"
        />
      </label>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={submitting || !password || !confirm}
        className="w-full px-3 py-2 rounded bg-[var(--portal-accent)] text-zinc-950 text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitting ? 'Setting up…' : 'Accept and sign in'}
      </button>
    </form>
  )
}
