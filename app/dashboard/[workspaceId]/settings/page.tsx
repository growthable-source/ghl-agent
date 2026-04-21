'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import WorkspaceAvatar from '@/components/dashboard/WorkspaceAvatar'

const WORKSPACE_ICONS = [
  '🚀', '⚡', '🎯', '💎', '🔥', '🌊', '🏔️', '🌿',
  '🦊', '🦅', '🐺', '🦁', '🐻', '🦉', '🐬', '🦈',
  '🏢', '🏗️', '🎨', '🔬', '💡', '🛡️', '⭐', '🌙',
]

interface Member {
  id: string
  role: string
  createdAt: string
  user: { id: string; name: string | null; email: string | null; image: string | null }
}

interface Invite {
  id: string
  email: string
  role: string
  acceptedAt: string | null
  expiresAt: string
  createdAt: string
}

export default function WorkspaceSettingsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [loading, setLoading] = useState(true)

  // Workspace info
  const [wsName, setWsName] = useState('')
  const [wsIcon, setWsIcon] = useState('🚀')
  const [wsLogoUrl, setWsLogoUrl] = useState<string | null>(null)
  const [logoMode, setLogoMode] = useState<'emoji' | 'upload' | 'url'>('emoji')
  const [pendingUrl, setPendingUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [savingWs, setSavingWs] = useState(false)
  const [wsSaved, setWsSaved] = useState(false)

  // Members
  const [members, setMembers] = useState<Member[]>([])

  // Invites
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [inviteSuccess, setInviteSuccess] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/workspaces').then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/members`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/invites`).then(r => r.json()),
    ]).then(([wsData, memberData, inviteData]) => {
      const ws = wsData.workspaces?.find((w: any) => w.id === workspaceId)
      if (ws) {
        setWsName(ws.name)
        setWsIcon(ws.icon || '🚀')
        setWsLogoUrl(ws.logoUrl ?? null)
        // Start on whichever mode the workspace is currently using so
        // the operator lands on the relevant controls without clicking.
        if (ws.logoUrl) {
          setLogoMode(ws.logoUrl.startsWith('http') ? 'url' : 'upload')
          setPendingUrl(ws.logoUrl)
        }
      }
      setMembers(memberData.members || [])
      setInvites(inviteData.invites || [])
    }).finally(() => setLoading(false))
  }, [workspaceId])

  async function saveWorkspace(e: React.FormEvent) {
    e.preventDefault()
    if (!wsName.trim()) return
    setSavingWs(true)
    setWsSaved(false)
    await fetch(`/api/workspaces/${workspaceId}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: wsName.trim(), icon: wsIcon }),
    })
    setSavingWs(false)
    setWsSaved(true)
    setTimeout(() => setWsSaved(false), 2000)
  }

  // Upload a file from the picker. On success updates wsLogoUrl so the
  // avatar swaps immediately without a save-and-reload round-trip.
  async function uploadLogo(file: File) {
    setUploading(true)
    setLogoError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/workspaces/${workspaceId}/logo/upload`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Upload failed (${res.status})`)
      }
      const data = await res.json()
      setWsLogoUrl(data.logoUrl)
      setPendingUrl(data.logoUrl)
    } catch (err: any) {
      setLogoError(err.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // Apply a pasted URL via the existing workspace PATCH. Uses the same
  // endpoint as name/icon edits so role gating is consistent.
  async function applyUrlLogo() {
    setLogoError(null)
    const url = pendingUrl.trim()
    if (!url) { setLogoError('Enter a URL first.'); return }
    const res = await fetch(`/api/workspaces/${workspaceId}/members`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logoUrl: url }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setLogoError(body.error || `Failed (${res.status})`)
      return
    }
    setWsLogoUrl(url)
  }

  // Clear back to emoji. Uses the DELETE on the upload endpoint for
  // consistency (same gate + audit as the upload path), but could use
  // PATCH { logoUrl: null } — either is fine.
  async function removeLogo() {
    setLogoError(null)
    const res = await fetch(`/api/workspaces/${workspaceId}/logo/upload`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setLogoError(body.error || `Remove failed (${res.status})`)
      return
    }
    setWsLogoUrl(null)
    setPendingUrl('')
    setLogoMode('emoji')
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault()
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    setInviting(true)
    setInviteError('')
    setInviteSuccess('')
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: [email] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to send invite')
      setInviteEmail('')
      setInviteSuccess(`Invite sent to ${email}`)
      // Refresh invites
      const inviteRes = await fetch(`/api/workspaces/${workspaceId}/invites`)
      const inviteData = await inviteRes.json()
      setInvites(inviteData.invites || [])
      setTimeout(() => setInviteSuccess(''), 3000)
    } catch (err: any) {
      setInviteError(err.message)
    } finally {
      setInviting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-zinc-500 text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-xl font-semibold mb-1">Workspace Settings</h1>
        <p className="text-zinc-400 text-sm">Manage your workspace details and team members.</p>
      </div>

      {/* ─── Workspace Details ─── */}
      <form onSubmit={saveWorkspace} className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 mb-6">
        <h2 className="text-sm font-medium text-zinc-200 mb-4">General</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Workspace name</label>
            <div className="flex items-center gap-3">
              <WorkspaceAvatar
                logoUrl={wsLogoUrl}
                icon={wsIcon}
                size={44}
                className="bg-zinc-900 border border-zinc-700 rounded-lg"
              />
              <input
                type="text"
                value={wsName}
                onChange={e => setWsName(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>

          {/* ── Logo / icon picker ──
              Three modes — emoji (existing 24-option grid), upload
              (Vercel Blob), or paste a URL. A "Remove logo" button
              appears whenever a logoUrl is set so operators can go
              back to the emoji cleanly. */}
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Brand avatar</label>
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900 p-0.5 text-[11px] mb-2">
              {(['emoji', 'upload', 'url'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setLogoMode(m); setLogoError(null) }}
                  className={`px-3 py-1 rounded-md transition-colors ${
                    logoMode === m ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {m === 'emoji' ? 'Emoji' : m === 'upload' ? 'Upload' : 'Paste URL'}
                </button>
              ))}
            </div>

            {logoMode === 'emoji' && (
              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 grid grid-cols-8 gap-1">
                {WORKSPACE_ICONS.map(ic => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setWsIcon(ic)}
                    className={`w-9 h-9 rounded-md flex items-center justify-center text-lg transition-colors hover:bg-zinc-700 ${
                      wsIcon === ic && !wsLogoUrl ? 'bg-zinc-700 ring-1 ring-zinc-500' : ''
                    }`}
                  >
                    {ic}
                  </button>
                ))}
                <p className="col-span-8 text-[11px] text-zinc-600 mt-1">
                  The emoji shows when no logo image is set. Click Save below to persist
                  the choice.
                </p>
              </div>
            )}

            {logoMode === 'upload' && (
              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) uploadLogo(f)
                  }}
                  className="block w-full text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-zinc-800 file:text-white hover:file:bg-zinc-700"
                />
                <p className="text-[11px] text-zinc-600">
                  PNG, JPEG, WebP, SVG, or GIF up to 2 MB. Square images look best in the sidebar.
                </p>
                {uploading && <p className="text-[11px] text-zinc-400">Uploading…</p>}
              </div>
            )}

            {logoMode === 'url' && (
              <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={pendingUrl}
                    onChange={e => setPendingUrl(e.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  <button
                    type="button"
                    onClick={applyUrlLogo}
                    className="rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white font-medium text-xs px-3 transition-colors"
                  >
                    Apply
                  </button>
                </div>
                <p className="text-[11px] text-zinc-600">
                  Must be a publicly-reachable https URL. If the URL 404s or changes later,
                  the sidebar falls back to the emoji automatically.
                </p>
              </div>
            )}

            {logoError && (
              <p className="text-[11px] text-red-400 mt-2">{logoError}</p>
            )}

            {wsLogoUrl && (
              <button
                type="button"
                onClick={removeLogo}
                className="mt-2 text-[11px] text-zinc-500 hover:text-red-400 transition-colors"
              >
                Remove logo · fall back to emoji
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={savingWs}
              className="rounded-lg bg-white text-black font-medium text-sm px-4 h-9 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {savingWs ? 'Saving...' : 'Save'}
            </button>
            {wsSaved && <span className="text-xs text-emerald-400">Saved</span>}
          </div>
        </div>
      </form>

      {/* ─── Billing ─── */}
      <Link
        href={`/dashboard/${workspaceId}/settings/billing`}
        className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 mb-6 flex items-center justify-between group hover:border-zinc-700 transition-colors"
      >
        <div>
          <h2 className="text-sm font-medium text-zinc-200 mb-1">Billing & Usage</h2>
          <p className="text-xs text-zinc-500">Manage your plan, view usage, and update payment details.</p>
        </div>
        <span className="text-zinc-600 group-hover:text-zinc-400 transition-colors">→</span>
      </Link>

      {/* ─── Team Members ─── */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 mb-6">
        <h2 className="text-sm font-medium text-zinc-200 mb-1">Team Members</h2>
        <p className="text-xs text-zinc-500 mb-4">People with access to this workspace.</p>

        <div className="space-y-2 mb-5">
          {members.map(member => (
            <div key={member.id} className="flex items-center justify-between rounded-lg bg-zinc-900 border border-zinc-800 px-4 py-3">
              <div className="flex items-center gap-3 min-w-0">
                {member.user.image ? (
                  <img src={member.user.image} alt="" className="w-8 h-8 rounded-full shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs text-zinc-300 shrink-0">
                    {(member.user.name || member.user.email || '?')[0].toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm text-zinc-200 font-medium truncate">
                    {member.user.name || 'Unnamed'}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">{member.user.email}</p>
                </div>
              </div>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${
                member.role === 'owner'
                  ? 'bg-amber-900/30 text-amber-400'
                  : member.role === 'admin'
                  ? 'bg-blue-900/30 text-blue-400'
                  : 'bg-zinc-800 text-zinc-400'
              }`}>
                {member.role.charAt(0).toUpperCase() + member.role.slice(1)}
              </span>
            </div>
          ))}
        </div>

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="mb-5">
            <p className="text-xs font-medium text-zinc-500 mb-2">Pending Invites</p>
            <div className="space-y-1.5">
              {invites.map(invite => (
                <div key={invite.id} className="flex items-center justify-between rounded-lg bg-zinc-900/50 border border-zinc-800/50 px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center shrink-0">
                      <svg className="w-3 h-3 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                      </svg>
                    </div>
                    <span className="text-sm text-zinc-400 truncate">{invite.email}</span>
                  </div>
                  <span className="text-[11px] text-zinc-600 shrink-0">
                    {invite.acceptedAt ? 'Accepted' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Invite form */}
        <form onSubmit={sendInvite} className="pt-4 border-t border-zinc-800">
          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Invite a teammate</label>
          <div className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
            <button
              type="submit"
              disabled={inviting || !inviteEmail.trim()}
              className="rounded-lg bg-white text-black font-medium text-sm px-4 h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50 shrink-0"
            >
              {inviting ? 'Sending...' : 'Invite'}
            </button>
          </div>
          {inviteError && <p className="text-xs text-red-400 mt-2">{inviteError}</p>}
          {inviteSuccess && <p className="text-xs text-emerald-400 mt-2">{inviteSuccess}</p>}
        </form>
      </div>
    </div>
  )
}
