'use client'

import { useRouter } from 'next/navigation'
import { Fragment, useRef, useState } from 'react'

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

interface PortalBrandingInfo {
  slug: string
  customDomain: string | null
  logoUrl: string | null
  primaryColor: string | null
}

export default function PortalDetailClient({
  portalId, brands, allBrands, users, invites, branding, reportFrequency,
}: {
  portalId: string
  brands: Brand[]
  allBrands: BrandWithWorkspace[]
  users: PortalUser[]
  invites: PortalInvite[]
  branding: PortalBrandingInfo
  reportFrequency: string
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

  // Per-row resend feedback: which invite is in flight, and the outcome
  // of the last resend (needed to surface the copy-paste link when
  // Resend isn't configured).
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [resendMsg, setResendMsg] = useState<{ id: string; ok: boolean; text: string } | null>(null)

  async function resendInvite(inviteId: string, email: string) {
    setResendingId(inviteId)
    setResendMsg(null)
    try {
      const res = await fetch(`/api/admin/portals/${portalId}/invites/${inviteId}/resend`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setResendMsg({ id: inviteId, ok: false, text: body?.error ?? `Error ${res.status}` })
      } else {
        setResendMsg({
          id: inviteId,
          ok: true,
          text: body?.emailSent
            ? `Invite re-sent to ${email}.`
            : `New link created. Email not sent (RESEND_API_KEY missing). Share this link: ${body?.inviteUrl ?? ''}`,
        })
        router.refresh()
      }
    } catch (err) {
      setResendMsg({ id: inviteId, ok: false, text: err instanceof Error ? err.message : 'Network error' })
    } finally {
      setResendingId(null)
    }
  }

  async function setUserActive(userId: string, isActive: boolean) {
    if (!isActive && !confirm('Deactivate this portal user? They will no longer be able to log in.')) return
    const res = await fetch(`/api/admin/portals/${portalId}/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive }),
    })
    if (res.ok) router.refresh()
  }

  async function removeUser(userId: string, email: string) {
    if (!confirm(`Permanently remove ${email} from this portal? This deletes their account and brand assignments. You can invite them again later.`)) return
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

      <WhitelabelSection
        portalId={portalId}
        branding={branding}
        onChanged={() => router.refresh()}
      />

      <ReportScheduleSection portalId={portalId} initialFrequency={reportFrequency} />

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
                  <Fragment key={i.id}>
                    <tr className="border-t border-zinc-800">
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
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => resendInvite(i.id, i.email)}
                          disabled={resendingId === i.id}
                          className="text-zinc-400 hover:text-amber-400 text-xs disabled:opacity-50 mr-3"
                        >
                          {resendingId === i.id ? 'Sending…' : 'Resend'}
                        </button>
                        <button
                          onClick={() => revokeInvite(i.id)}
                          className="text-zinc-500 hover:text-red-400 text-xs"
                        >
                          Revoke
                        </button>
                      </td>
                    </tr>
                    {resendMsg?.id === i.id && (
                      <tr className="border-t border-zinc-800/50">
                        <td colSpan={5} className={`px-4 py-2 text-xs break-all ${resendMsg.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                          {resendMsg.text}
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
                onSetActive={active => setUserActive(u.id, active)}
                onRemove={() => removeUser(u.id, u.email)}
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
  portalId, user, brands, onSetActive, onRemove, onChanged,
}: {
  portalId: string
  user: PortalUser
  brands: Brand[]
  onSetActive: (active: boolean) => void
  onRemove: () => void
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
          {user.isActive ? (
            <button
              onClick={() => onSetActive(false)}
              className="text-xs text-zinc-500 hover:text-red-400"
            >
              Deactivate
            </button>
          ) : (
            <button
              onClick={() => onSetActive(true)}
              className="text-xs text-emerald-500 hover:text-emerald-400"
            >
              Reactivate
            </button>
          )}
          <button
            onClick={onRemove}
            className="text-xs text-zinc-600 hover:text-red-400"
          >
            Remove
          </button>
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

function WhitelabelSection({
  portalId, branding, onChanged,
}: {
  portalId: string
  branding: PortalBrandingInfo
  onChanged: () => void
}) {
  const [customDomain, setCustomDomain] = useState(branding.customDomain ?? '')
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl ?? '')
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  async function uploadLogo(file: File) {
    setError(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/admin/portals/${portalId}/logo`, { method: 'POST', body: fd })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error ?? `Upload failed (${res.status})`)
        return
      }
      setLogoUrl(body.logoUrl) // fills the field + marks dirty; persisted on Save
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const dirty =
    customDomain !== (branding.customDomain ?? '') ||
    logoUrl !== (branding.logoUrl ?? '') ||
    primaryColor !== (branding.primaryColor ?? '')

  async function save() {
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/portals/${portalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customDomain: customDomain.trim() || null,
          logoUrl: logoUrl.trim() || null,
          primaryColor: primaryColor.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error ?? `Error ${res.status}`)
        setSaving(false)
        return
      }
      setSaved(true)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  const swatch = primaryColor.trim() || '#fbbf24'

  // The URLs customers actually use. With a custom domain the portal
  // serves from the domain ROOT (middleware rewrites '/' → /portal on
  // non-primary hosts); without one it's /portal on the app origin.
  // The embed variant is what agencies paste into a CRM custom menu
  // link. Built from the SAVED domain — an unsaved edit doesn't count.
  const savedDomain = (branding.customDomain ?? '').trim()
  const appOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://app.xovera.io'
  // Without a custom domain the portal has NO unique URL — /portal is
  // shared, and which portal a customer sees is decided by their login.
  // The honest shareable link is therefore the login page with the
  // portal's slug (?p=) so at least the branding is right. A custom
  // domain is what makes a portal address truly its own.
  const portalUrl = savedDomain ? `https://${savedDomain}` : `${appOrigin}/portal/login?p=${branding.slug}`
  const embedUrl = savedDomain
    ? `https://${savedDomain}/portal?embedded=leadconnector`
    : `${appOrigin}/portal/login?p=${branding.slug}&embedded=leadconnector`
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  function copyUrl(value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedUrl(value)
      setTimeout(() => setCopiedUrl(null), 2000)
    })
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-white mb-3">Whitelabel &amp; branding</h2>
      <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/30 space-y-4">
        {/* Where this portal actually lives — copy-paste ready. */}
        <div className="space-y-2">
          {([
            { label: 'Portal URL', value: portalUrl, hint: savedDomain ? 'Custom domain (serves the portal at the root)' : 'Shared login page with this portal\u2019s branding \u2014 set a custom domain for a truly unique address' },
            { label: 'CRM menu link', value: embedUrl, hint: 'Paste into a LeadConnector custom menu link to embed the portal' },
          ] as const).map(u => (
            <div key={u.label} className="flex items-center gap-2">
              <div className="w-28 shrink-0 text-xs text-zinc-500">{u.label}</div>
              <a
                href={u.value}
                target="_blank"
                rel="noreferrer"
                className="flex-1 min-w-0 truncate font-mono text-xs text-zinc-300 hover:text-white hover:underline"
                title={u.hint}
              >
                {u.value}
              </a>
              <button
                type="button"
                onClick={() => copyUrl(u.value)}
                className="shrink-0 text-xs px-2.5 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
              >
                {copiedUrl === u.value ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          ))}
          <div className="pt-1">
            {/* Plain <a>: the impersonate endpoint is an API route that
                answers with a 302 into the portal — next/link 404s on it. */}
            <a
              href={`/api/admin/portals/${portalId}/impersonate`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded border border-amber-400/40 text-amber-300 hover:bg-amber-400/10 transition-colors"
              title="Opens a 2-hour portal session scoped to this portal's brands — no portal account needed"
            >
              Open portal as admin →
            </a>
          </div>
        </div>

        <div className="border-t border-zinc-800" />

        <div>
          <label className="block text-sm text-zinc-300 mb-1.5">Custom domain</label>
          <input
            value={customDomain}
            onChange={e => setCustomDomain(e.target.value)}
            placeholder="support.theirbrand.com"
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 font-mono focus:border-amber-400 outline-none"
          />
          <p className="text-xs text-zinc-500 mt-1.5">
            The customer points a <span className="font-mono text-zinc-400">CNAME</span> for this host at{' '}
            <span className="font-mono text-zinc-400">cname.vercel-dns.com</span>, and you add the domain to the
            Vercel project. Until then it won&rsquo;t resolve. Leave blank to use the default URL{' '}
            <span className="font-mono text-zinc-400">/portal</span> (slug: {branding.slug}).
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-sm text-zinc-300 mb-1.5">Logo</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="shrink-0 px-3 py-2 rounded text-sm font-medium border border-zinc-700 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
              >
                {uploading ? 'Uploading…' : 'Upload file'}
              </button>
              <input
                value={logoUrl}
                onChange={e => setLogoUrl(e.target.value)}
                placeholder="…or paste an image URL"
                className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
              className="hidden"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void uploadLogo(f)
                e.target.value = ''
              }}
            />
            <p className="text-xs text-zinc-500 mt-1.5">PNG, JPEG, WebP, SVG, or GIF — up to 2 MB.</p>
          </div>
          <div className="w-44">
            <label className="block text-sm text-zinc-300 mb-1.5">Primary color</label>
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded border border-zinc-700 shrink-0" style={{ background: swatch }} />
              <input
                value={primaryColor}
                onChange={e => setPrimaryColor(e.target.value)}
                placeholder="#2563eb"
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 font-mono focus:border-amber-400 outline-none"
              />
            </div>
          </div>
        </div>
        {logoUrl.trim() && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo preview" className="h-8" />
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="px-3 py-1.5 rounded bg-amber-400 text-zinc-950 text-sm font-medium hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save branding'}
          </button>
          {saved && !dirty && <span className="text-sm text-emerald-400">✓ Saved</span>}
        </div>
      </div>
    </section>
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

// ─── Scheduled email reports ─────────────────────────────────────────────
// Frequency select (saved via the portal PATCH) + a test-send box so the
// report can be iterated on a real inbox before customers ever see one.
// The same frequency setting is exposed to portal users in /portal/settings.
function ReportScheduleSection({ portalId, initialFrequency }: { portalId: string; initialFrequency: string }) {
  const [frequency, setFrequency] = useState(initialFrequency)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [testEmail, setTestEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function saveFrequency(next: string) {
    setFrequency(next)
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch(`/api/admin/portals/${portalId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportFrequency: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `Error ${res.status}`)
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (err) {
      setSaveMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function sendTest(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setTestMsg(null)
    try {
      const res = await fetch(`/api/admin/portals/${portalId}/send-report-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error ?? `Error ${res.status}`)
      setTestMsg({ ok: true, text: `Sent to ${testEmail} — check the inbox.` })
    } catch (err) {
      setTestMsg({ ok: false, text: err instanceof Error ? err.message : 'Send failed' })
    } finally {
      setSending(false)
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-white mb-3">Email reports</h2>
      <div className="border border-zinc-800 rounded-lg p-5 bg-zinc-900/30 space-y-4">
        <div>
          <label className="block text-sm text-zinc-300 mb-1.5">Send scheduled reports to portal users</label>
          <div className="flex items-center gap-2">
            {(['off', 'daily', 'weekly'] as const).map(f => (
              <button
                key={f}
                type="button"
                disabled={saving}
                onClick={() => saveFrequency(f)}
                className={`text-sm px-3.5 py-1.5 rounded border transition-colors ${
                  frequency === f
                    ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                    : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {f === 'off' ? 'Off' : f === 'daily' ? 'Daily' : 'Weekly'}
              </button>
            ))}
            {saveMsg && <span className="text-xs text-zinc-500">{saveMsg}</span>}
          </div>
          <p className="text-xs text-zinc-500 mt-1.5">
            Every active portal user gets the report by email: KPIs, estimated time saved,
            anything outstanding or urgent, top topics, and the AI insights briefing.
            Portal users can also change this from their portal Settings.
          </p>
        </div>

        <form onSubmit={sendTest} className="flex items-center gap-2 flex-wrap">
          <input
            type="email"
            required
            value={testEmail}
            onChange={e => setTestEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-64 bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
          />
          <button
            type="submit"
            disabled={sending}
            className="text-sm font-medium px-3.5 py-2 rounded border border-zinc-700 text-zinc-200 hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {sending ? 'Sending…' : 'Send test report'}
          </button>
          {testMsg && (
            <span className={`text-xs ${testMsg.ok ? 'text-emerald-400' : 'text-rose-400'}`}>{testMsg.text}</span>
          )}
        </form>
      </div>
    </section>
  )
}
