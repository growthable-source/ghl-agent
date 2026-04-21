'use client'

import { useEffect, useState } from 'react'

interface SetupState {
  ready: boolean               // server says "zero admins, accepting setup"
  requiresToken: boolean       // ADMIN_BOOTSTRAP_SECRET is set, prompt for it
  alreadyConfigured: boolean   // at least one admin exists — setup locked
  error: string | null
}

/**
 * One-time web bootstrap for the first super-admin.
 *
 * The server enforces that this only works when zero admins exist. After
 * the first successful POST, every subsequent GET returns
 * `alreadyConfigured: true` and the form is gone forever.
 *
 * If ADMIN_BOOTSTRAP_SECRET is set in env, we additionally require it
 * in the POST — useful for shared Vercel previews where you don't want
 * a random visitor to claim the first-admin slot.
 */
export default function AdminSetupPage() {
  const [state, setState] = useState<SetupState>({ ready: false, requiresToken: false, alreadyConfigured: false, error: null })
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [token, setToken] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/admin/setup').then(r => r.json()).then(setState).catch(e => setState(s => ({ ...s, error: e.message })))
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setState(s => ({ ...s, error: 'Passwords do not match.' })); return }
    if (password.length < 10) { setState(s => ({ ...s, error: 'Password must be at least 10 characters.' })); return }
    setSubmitting(true)
    setState(s => ({ ...s, error: null }))
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || null, password, token: token || undefined }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Setup failed (${res.status})`)
      }
      // Server has signed us in. Full reload so the /admin layout re-runs.
      window.location.href = '/admin'
    } catch (err: any) {
      setState(s => ({ ...s, error: err.message }))
      setSubmitting(false)
    }
  }

  if (state.alreadyConfigured) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 px-4">
        <div className="w-full max-w-sm text-center space-y-3">
          <h1 className="text-2xl font-semibold">Setup complete</h1>
          <p className="text-sm text-zinc-400">
            A super admin is already configured. This page is disabled — there&apos;s no way back.
          </p>
          <a href="/admin/login" className="inline-block text-sm text-blue-400 hover:text-blue-300 pt-4">
            Go to sign in →
          </a>
        </div>
      </div>
    )
  }

  if (!state.ready && !state.error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100">
        <p className="text-sm text-zinc-500">Checking setup state…</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/90">Voxility</p>
          <h1 className="text-2xl font-semibold mt-1">Create the first admin</h1>
          <p className="text-xs text-zinc-500 mt-1.5 leading-relaxed">
            This page only works once. After the first super admin is created,
            it&apos;s sealed off permanently.
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
            <label className="block text-xs text-zinc-400 mb-1.5">
              Name <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              autoComplete="name"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
            />
            <p className="text-[11px] text-zinc-600 mt-1">At least 10 characters. Use a password manager.</p>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
            />
          </div>

          {state.requiresToken && (
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Bootstrap token</label>
              <input
                type="password"
                value={token}
                onChange={e => setToken(e.target.value)}
                required
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
              />
              <p className="text-[11px] text-zinc-600 mt-1">
                Your deployment has <span className="font-mono">ADMIN_BOOTSTRAP_SECRET</span> set.
                Paste its value here to authorise this one-time setup.
              </p>
            </div>
          )}

          {state.error && (
            <p className="text-xs text-red-400 leading-snug">{state.error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Creating…' : 'Create admin & sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
