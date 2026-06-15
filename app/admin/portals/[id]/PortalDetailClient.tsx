'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Brand { id: string; name: string; slug: string }
interface BrandWithWorkspace { id: string; name: string; slug: string; workspace: { id: string; name: string } }
interface PortalUser {
  id: string
  email: string
  name: string | null
  isActive: boolean
  acceptedAt: string | null
  lastLoginAt: string | null
  invitedAt: string
  brandIds: string[]
}
interface PortalInvite {
  id: string
  email: string
  expiresAt: string
  createdAt: string
  brandIds: string[]
}

export default function PortalDetailClient({
  portalId, brands, allBrands, users, invites,
}: {
  portalId: string
  brands: Brand[]
  allBrands: BrandWithWorkspace[]
  users: PortalUser[]
  invites: PortalInvite[]
}) {
  const router = useRouter()
  const brandLabel = (id: string) => brands.find(b => b.id === id)?.name ?? id

  // ─── Invite form state ──────────────────────────────────────────────
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteBrandIds, setInviteBrandIds] = useState<Set<string>>(new Set())
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteOk, setInviteOk] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)

  function toggleInviteBrand(id: string) {
    setInviteBrandIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteError(null)
    setInviteOk(null)
    setInviting(true)
    try {
      const res = await fetch(`/api/admin/portals/${portalId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, brandIds: Array.from(inviteBrandIds) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setInviteError(body?.error ?? `Error ${res.status}`)
      } else {
        setInviteOk(body?.emailSent
          ? `Invite sent to ${inviteEmail}.`
          : `Invite created. Email not sent (RESEND_API_KEY missing). Share this link: ${body?.inviteUrl ?? ''}`)
        setInviteEmail('')
        setInviteBrandIds(new Set())
        router.refresh()
      }
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setInviting(false)
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!confirm('Revoke this pending invitation?')) return
    const res = await fetch(`/api/admin/portals/${portalId}/invites/${inviteId}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  async function deactivateUser(userId: string) {
    if (!confirm('Deactivate this portal user? They will no longer be able to log in.')) return
    const res = await fetch(`/api/admin/portals/${portalId}/users/${userId}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
  }

  return (
    <div className="space-y-10">
      <BrandCatalogSection
        portalId={portalId}
        catalog={brands}
        allBrands={allBrands}
        onChanged={() => router.refresh()}
      />

      {/* ─── Invite form ─── */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Invite a customer</h2>
        <form onSubmit={sendInvite} className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/30 space-y-4">
          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">Email</label>
            <input
              required
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="customer@example.com"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm text-zinc-300 mb-1.5">Assign brands</label>
            {brands.length === 0 ? (
              <p className="text-xs text-zinc-500">No brands in this portal yet. Add some under “Brands in this portal” above.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {brands.map(b => {
                  const on = inviteBrandIds.has(b.id)
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleInviteBrand(b.id)}
                      className={
                        'px-2.5 py-1 rounded text-xs border transition-colors ' +
                        (on
                          ? 'bg-amber-400 text-zinc-950 border-amber-400'
                          : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600')
                      }
                    >
                      {b.name}
                    </button>
                  )
                })}
              </div>
            )}
            <p className="text-xs text-zinc-500 mt-1.5">
              The user will only see conversations for the brands you select.
            </p>
          </div>
          {inviteError && <p className="text-sm text-red-400">{inviteError}</p>}
          {inviteOk && <p className="text-sm text-emerald-400 break-all">{inviteOk}</p>}
          <button
            type="submit"
            disabled={inviting || !inviteEmail || inviteBrandIds.size === 0}
            className="px-3 py-1.5 rounded bg-amber-400 text-zinc-950 text-sm font-medium hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {inviting ? 'Sending…' : 'Send invitation'}
          </button>
        </form>
      </section>

      {/* ─── Pending invites ─── */}
      {invites.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-white mb-3">Pending invitations</h2>
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Email</th>
                  <th className="text-left px-4 py-2 font-medium">Brands</th>
                  <th className="text-left px-4 py-2 font-medium">Sent</th>
                  <th className="text-left px-4 py-2 font-medium">Expires</th>
                  <th className="text-right px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {invites.map(i => (
                  <tr key={i.id} className="border-t border-zinc-800">
                    <td className="px-4 py-3 text-zinc-100">{i.email}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      {i.brandIds.map(brandLabel).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(i.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 text-xs">
                      {new Date(i.expiresAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => revokeInvite(i.id)}
                        className="text-zinc-500 hover:text-red-400 text-xs"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── Active users ─── */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Portal users</h2>
        {users.length === 0 ? (
          <div className="border border-dashed border-zinc-800 rounded-lg p-6 text-center">
            <p className="text-sm text-zinc-500">No users have accepted invitations yet.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {users.map(u => (
              <UserCard
                key={u.id}
                portalId={portalId}
                user={u}
                brands={brands}
                onDeactivate={() => deactivateUser(u.id)}
                onChanged={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function UserCard({
  portalId, user, brands, onDeactivate, onChanged,
}: {
  portalId: string
  user: PortalUser
  brands: Brand[]
  onDeactivate: () => void
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set(user.brandIds))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/portals/${portalId}/users/${user.id}/brands`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandIds: Array.from(selected) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? `Error ${res.status}`)
        setSaving(false)
        return
      }
      setEditing(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/30">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-zinc-100 font-medium">{user.name ?? user.email}</p>
          {user.name && <p className="text-xs text-zinc-500">{user.email}</p>}
          <p className="text-[11px] text-zinc-600 mt-1">
            {user.acceptedAt
              ? `Accepted ${new Date(user.acceptedAt).toLocaleDateString()}`
              : `Invited ${new Date(user.invitedAt).toLocaleDateString()} (not yet accepted)`}
            {user.lastLoginAt && (
              <> · Last login {new Date(user.lastLoginAt).toLocaleDateString()}</>
            )}
            {!user.isActive && <span className="text-red-400"> · Deactivated</span>}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="text-xs text-zinc-400 hover:text-amber-400"
            >
              Edit brands
            </button>
          )}
          {user.isActive && (
            <button
              onClick={onDeactivate}
              className="text-xs text-zinc-500 hover:text-red-400"
            >
              Deactivate
            </button>
          )}
        </div>
      </div>

      <div className="mt-3">
        {editing ? (
          <>
            <div className="flex flex-wrap gap-2">
              {brands.map(b => {
                const on = selected.has(b.id)
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggle(b.id)}
                    className={
                      'px-2.5 py-1 rounded text-xs border transition-colors ' +
                      (on
                        ? 'bg-amber-400 text-zinc-950 border-amber-400'
                        : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600')
                    }
                  >
                    {b.name}
                  </button>
                )
              })}
            </div>
            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={save}
                disabled={saving}
                className="px-2.5 py-1 rounded bg-amber-400 text-zinc-950 text-xs font-medium hover:bg-amber-300 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={() => { setEditing(false); setSelected(new Set(user.brandIds)) }}
                className="px-2.5 py-1 rounded border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {user.brandIds.length === 0 ? (
              <span className="text-xs text-zinc-500">No brands assigned (user sees nothing).</span>
            ) : (
              user.brandIds.map(id => (
                <span
                  key={id}
                  className="px-2 py-0.5 rounded text-xs bg-zinc-900 text-zinc-300 border border-zinc-800"
                >
                  {brands.find(b => b.id === id)?.name ?? id}
                </span>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function BrandCatalogSection({
  portalId, catalog, allBrands, onChanged,
}: {
  portalId: string
  catalog: Brand[]
  allBrands: BrandWithWorkspace[]
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set(catalog.map(b => b.id)))
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const q = query.trim().toLowerCase()
  const visible = q
    ? allBrands.filter(b => b.name.toLowerCase().includes(q) || b.workspace.name.toLowerCase().includes(q))
    : allBrands
  const groups = new Map<string, BrandWithWorkspace[]>()
  for (const b of visible) {
    const arr = groups.get(b.workspace.name) ?? []
    arr.push(b)
    groups.set(b.workspace.name, arr)
  }

  async function save() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/portals/${portalId}/brands`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandIds: Array.from(selected) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? `Error ${res.status}`)
        setSaving(false)
        return
      }
      setEditing(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-white">Brands in this portal</h2>
        {!editing && (
          <button
            onClick={() => { setSelected(new Set(catalog.map(b => b.id))); setEditing(true) }}
            className="text-xs text-zinc-400 hover:text-amber-400"
          >
            Edit brands
          </button>
        )}
      </div>
      <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/30">
        {!editing ? (
          catalog.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No brands yet. Click “Edit brands” to choose the brands this portal exposes — then invite customers.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {catalog.map(b => (
                <span key={b.id} className="px-2 py-0.5 rounded text-xs bg-zinc-900 text-zinc-300 border border-zinc-800">
                  {b.name}
                </span>
              ))}
            </div>
          )
        ) : (
          <>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search brands or workspaces…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none mb-3"
            />
            <div className="max-h-80 overflow-y-auto space-y-4">
              {Array.from(groups.entries()).map(([wsName, list]) => (
                <div key={wsName}>
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">{wsName}</p>
                  <div className="flex flex-wrap gap-2">
                    {list.map(b => {
                      const on = selected.has(b.id)
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => toggle(b.id)}
                          className={
                            'px-2.5 py-1 rounded text-xs border transition-colors ' +
                            (on
                              ? 'bg-amber-400 text-zinc-950 border-amber-400'
                              : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600')
                          }
                        >
                          {b.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {visible.length === 0 && <p className="text-xs text-zinc-500">No brands match “{query}”.</p>}
            </div>
            {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={save}
                disabled={saving}
                className="px-2.5 py-1 rounded bg-amber-400 text-zinc-950 text-xs font-medium hover:bg-amber-300 disabled:opacity-50"
              >
                {saving ? 'Saving…' : `Save ${selected.size} brand${selected.size === 1 ? '' : 's'}`}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="px-2.5 py-1 rounded border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
