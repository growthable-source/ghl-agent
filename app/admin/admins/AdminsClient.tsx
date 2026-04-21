'use client'

import { useState } from 'react'

interface AdminRow {
  id: string
  email: string
  name: string | null
  role: string
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  twoFactorVerifiedAt: string | null
}

export default function AdminsClient({
  initial,
  currentAdminId,
}: {
  initial: AdminRow[]
  currentAdminId: string
}) {
  const [admins, setAdmins] = useState<AdminRow[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'admin' })

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null)
    try {
      const res = await fetch(`/api/admin/admins/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || `Update failed (${res.status})`)
      const { admin } = await res.json()
      setAdmins(prev => prev.map(a => a.id === id ? { ...a, ...admin, lastLoginAt: admin.lastLoginAt ?? a.lastLoginAt } : a))
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function remove(id: string, email: string) {
    if (!confirm(`Delete admin ${email}? This cannot be undone.`)) return
    setError(null)
    try {
      const res = await fetch(`/api/admin/admins/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error || `Delete failed (${res.status})`)
      setAdmins(prev => prev.filter(a => a.id !== id))
    } catch (err: any) {
      setError(err.message)
    }
  }

  async function resetPassword(id: string) {
    const pw = prompt('New password (10+ characters). The admin will be forced to re-enrol 2FA on next login.')
    if (!pw) return
    if (pw.length < 10) { setError('Password must be at least 10 characters'); return }
    await patch(id, { password: pw })
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error((await res.json()).error || `Create failed (${res.status})`)
      const { admin } = await res.json()
      setAdmins(prev => [...prev, {
        ...admin,
        lastLoginAt: null,
        twoFactorVerifiedAt: null,
        createdAt: admin.createdAt,
      }])
      setForm({ email: '', name: '', password: '', role: 'admin' })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <p className="text-xs text-red-400 rounded-lg border border-red-500/30 bg-red-500/[0.05] px-3 py-2">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 text-[10px] uppercase tracking-wider">
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-2 font-semibold">Admin</th>
              <th className="text-left px-4 py-2 font-semibold">Role</th>
              <th className="text-left px-4 py-2 font-semibold">Status</th>
              <th className="text-left px-4 py-2 font-semibold">2FA</th>
              <th className="text-left px-4 py-2 font-semibold">Last login</th>
              <th className="text-left px-4 py-2 font-semibold">Created</th>
              <th className="text-left px-4 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {admins.map(a => {
              const isSelf = a.id === currentAdminId
              return (
                <tr key={a.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-2">
                    <div className="text-zinc-200">{a.name ?? '(no name)'}</div>
                    <div className="text-zinc-500">{a.email}</div>
                    {isSelf && <div className="text-[10px] text-amber-400">you</div>}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      value={a.role}
                      onChange={e => patch(a.id, { role: e.target.value })}
                      disabled={isSelf}
                      className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      <option value="viewer">viewer</option>
                      <option value="admin">admin</option>
                      <option value="super">super</option>
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    {a.isActive ? (
                      <button
                        type="button"
                        onClick={() => patch(a.id, { isActive: false })}
                        disabled={isSelf}
                        className="text-emerald-400 hover:text-red-400 disabled:opacity-50 disabled:hover:text-emerald-400 transition-colors"
                      >
                        Active
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => patch(a.id, { isActive: true })}
                        className="text-zinc-500 hover:text-emerald-400 transition-colors"
                      >
                        Disabled · reactivate
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">
                    {a.twoFactorVerifiedAt ? '✓ enrolled' : '—'}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 font-mono">
                    {a.lastLoginAt ? a.lastLoginAt.slice(0, 16).replace('T', ' ') : 'never'}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 font-mono">{a.createdAt.slice(0, 10)}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => resetPassword(a.id)}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Reset password
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(a.id, a.email)}
                        disabled={isSelf}
                        className="text-xs text-zinc-600 hover:text-red-400 disabled:opacity-30 disabled:hover:text-zinc-600 transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <p className="text-sm font-medium text-zinc-200 mb-3">Add new admin</p>
        <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          <input
            type="email"
            value={form.email}
            onChange={e => setForm({ ...form, email: e.target.value })}
            placeholder="Email"
            required
            className="sm:col-span-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Name"
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
          <input
            type="password"
            value={form.password}
            onChange={e => setForm({ ...form, password: e.target.value })}
            placeholder="Password (10+)"
            minLength={10}
            required
            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
          />
          <div className="flex gap-2">
            <select
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
            >
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
              <option value="super">super</option>
            </select>
            <button
              type="submit"
              disabled={creating}
              className="text-sm font-medium text-black bg-white hover:bg-zinc-200 rounded-lg px-3 transition-colors disabled:opacity-50"
            >
              {creating ? '…' : 'Add'}
            </button>
          </div>
        </form>
        <p className="text-[11px] text-zinc-600 mt-3 leading-relaxed">
          New admins will need to sign in and enrol 2FA themselves at{' '}
          <span className="font-mono">/admin/2fa</span>. Password reset here forces a 2FA re-enrolment.
        </p>
      </div>
    </div>
  )
}
