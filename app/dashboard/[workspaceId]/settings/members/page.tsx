'use client'

/**
 * Workspace member management.
 *
 * Three sections:
 *   - Members — current team. Owners/admins can change roles + remove.
 *     Each row shows availability so an operator can spot who's
 *     covering inbox right now.
 *   - Invite — paste emails, pick a role, send. Same-domain free,
 *     cross-domain gated on plan.
 *   - Pending invites — outstanding invites the team hasn't accepted
 *     yet. Resend rotates the token + extends expiry; cancel deletes.
 *
 * Permissions in the UI mirror server-side gates from lib/permissions —
 * we surface what the operator CAN do; the server still authoritatively
 * rejects anything they shouldn't.
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ROLE_LABEL, ROLE_DESCRIPTION, type WorkspaceRole } from '@/lib/permissions'

interface Member {
  id: string
  role: WorkspaceRole
  createdAt: string
  isAvailable?: boolean
  user: { id: string; name: string | null; email: string | null; image: string | null }
}

interface PresenceEvent {
  state: string
  source: string
  at: string
}

interface ActivityMember {
  id: string
  user: { id: string; name: string | null; email: string | null; image: string | null }
  isAvailable: boolean
  availabilityChangedAt: string | null
  events: PresenceEvent[]
}

interface Invite {
  id: string
  email: string
  role: WorkspaceRole
  expiresAt: string
  createdAt: string
  expired: boolean
  inviter: { id: string; name: string | null; email: string | null } | null
}

export default function MembersPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const [myRole, setMyRole] = useState<WorkspaceRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  // Presence activity log — loaded on demand from /members/activity.
  const [activity, setActivity] = useState<ActivityMember[] | null>(null)
  const [activityOpen, setActivityOpen] = useState(false)

  // Invite form
  const [emailsInput, setEmailsInput] = useState('')
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member')
  const [sending, setSending] = useState(false)
  const [inviteResults, setInviteResults] = useState<Array<{ email: string; status: string }> | null>(null)

  const load = useCallback(async () => {
    try {
      const [m, i, me] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/members`).then(r => r.ok ? r.json() : { members: [] }),
        fetch(`/api/workspaces/${workspaceId}/invites`).then(r => r.ok ? r.json() : { invites: [] }),
        fetch('/api/me').then(r => r.ok ? r.json() : null),
      ])
      setMembers(m.members || [])
      setInvites(i.invites || [])
      if (me?.user?.id) {
        setMeId(me.user.id)
        const myRow = (m.members || []).find((row: Member) => row.user.id === me.user.id)
        if (myRow) setMyRole(myRow.role)
      }
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  async function loadActivity() {
    if (activity) { setActivityOpen(o => !o); return }
    setActivityOpen(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/activity?days=7`)
      const data = await res.json()
      setActivity(data?.members || [])
    } catch {
      setActivity([])
    }
  }

  const canManage = myRole === 'owner' || myRole === 'admin'
  const canAssignAdmin = myRole === 'owner'

  async function sendInvites(e: React.FormEvent) {
    e.preventDefault()
    const emails = emailsInput
      .split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
    if (emails.length === 0) return
    setSending(true)
    setInviteResults(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails, role: inviteRole }),
      })
      const data = await res.json()
      if (!res.ok) {
        setInviteResults([{ email: emails[0], status: data.error || 'error' }])
      } else {
        setInviteResults(data.results || [])
        if ((data.results || []).some((r: any) => r.status === 'invited')) {
          setEmailsInput('')
          await load()
        }
      }
    } finally {
      setSending(false)
    }
  }

  async function changeRole(memberId: string, role: WorkspaceRole) {
    setBusy(memberId)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to update role')
      } else {
        await load()
      }
    } finally { setBusy(null) }
  }

  async function removeMember(memberId: string, label: string) {
    if (!confirm(`Remove ${label} from this workspace?`)) return
    setBusy(memberId)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/members/${memberId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to remove member')
      } else {
        await load()
      }
    } finally { setBusy(null) }
  }

  async function cancelInvite(inviteId: string, email: string) {
    if (!confirm(`Cancel the invite to ${email}?`)) return
    setBusy(inviteId)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites/${inviteId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to cancel invite')
      } else {
        await load()
      }
    } finally { setBusy(null) }
  }

  async function resendInvite(inviteId: string) {
    setBusy(inviteId)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/invites/${inviteId}/resend`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to resend invite')
      } else {
        await load()
      }
    } finally { setBusy(null) }
  }

  if (loading) return (
    <div className="flex-1 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="h-8 w-40 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
      </div>
    </div>
  )

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Members</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Add teammates and decide who can do what.
          </p>
        </div>

        {/* Invite */}
        {canManage && (
          <form
            onSubmit={sendInvites}
            className="mb-8 rounded-xl border p-5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Invite teammates</h2>
            <div className="flex flex-col md:flex-row gap-3">
              <input
                type="text"
                value={emailsInput}
                onChange={e => setEmailsInput(e.target.value)}
                placeholder="email@team.com, second@team.com"
                className="flex-1 rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
              />
              <select
                value={inviteRole}
                onChange={e => setInviteRole(e.target.value as WorkspaceRole)}
                className="rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
              >
                {canAssignAdmin && <option value="admin">Admin</option>}
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={sending}
                className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                {sending ? 'Sending…' : 'Send invites'}
              </button>
            </div>
            <p className="text-[11px] mt-2" style={{ color: 'var(--text-tertiary)' }}>
              {ROLE_DESCRIPTION[inviteRole]}
            </p>
            {inviteResults && (
              <div className="mt-3 space-y-1">
                {inviteResults.map((r, i) => (
                  <p key={i} className="text-xs" style={{
                    color: r.status === 'invited' ? 'var(--accent-emerald)'
                      : r.status === 'already_member' ? 'var(--text-tertiary)'
                      : 'var(--accent-red)'
                  }}>
                    {r.email}: {prettyStatus(r.status)}
                  </p>
                ))}
              </div>
            )}
          </form>
        )}

        {/* Members */}
        <div
          className="rounded-xl border overflow-hidden mb-8"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: 'var(--border)' }}>
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              {members.length} member{members.length === 1 ? '' : 's'}
            </span>
            <button
              onClick={loadActivity}
              className="text-[10px] font-semibold text-orange-400 hover:text-orange-300"
            >
              {activityOpen ? 'Hide activity' : 'Activity (7d)'}
            </button>
          </div>
          {activityOpen && activity && (
            <div className="border-b" style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}>
              <div className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-tertiary)' }}>
                  Online / away events — last 7 days
                </p>
                {activity.length === 0 || activity.every(a => a.events.length === 0) ? (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    No presence history yet — events show up after operators toggle Available / Away in the inbox header.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activity.map(a => (
                      <div key={a.id}>
                        <p className="text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
                          {a.user.name || a.user.email}
                        </p>
                        <div className="space-y-0.5">
                          {a.events.length === 0 ? (
                            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>No toggles this week.</p>
                          ) : a.events.slice(0, 12).map((e, idx) => (
                            <p key={idx} className="text-[11px] flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                              <span className={`inline-block w-1.5 h-1.5 rounded-full ${e.state === 'available' ? 'bg-emerald-400' : 'bg-zinc-500'}`} />
                              <span style={{ color: e.state === 'available' ? 'var(--accent-emerald)' : 'var(--text-tertiary)' }}>
                                {e.state === 'available' ? 'Online' : 'Away'}
                              </span>
                              <span className="ml-auto text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{timeAgo(e.at)}</span>
                            </p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {members.map(m => {
            const isMe = m.user.id === meId
            const canRemove = canManage && !isMe && outrankClient(myRole, m.role)
            const canChange = canManage && !isMe && outrankClient(myRole, m.role)
            return (
              <div key={m.id} className="flex items-center gap-3 p-4 border-t" style={{ borderColor: 'var(--border)' }}>
                {m.user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.user.image} alt="" className="w-9 h-9 rounded-full" />
                ) : (
                  <span className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-semibold text-white">
                    {(m.user.name || m.user.email || '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {m.user.name || m.user.email}{isMe && <span className="ml-2 text-[10px] text-zinc-500">you</span>}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>{m.user.email}</p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded ${m.isAvailable ? 'bg-emerald-500/10 text-emerald-300' : 'bg-zinc-800 text-zinc-500'}`}>
                  {m.isAvailable ? 'Available' : 'Away'}
                </span>
                {canChange ? (
                  <select
                    value={m.role}
                    onChange={e => changeRole(m.id, e.target.value as WorkspaceRole)}
                    disabled={busy === m.id}
                    className="text-xs rounded px-2 py-1"
                    style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
                  >
                    {canAssignAdmin && <option value="admin">{ROLE_LABEL.admin}</option>}
                    <option value="member">{ROLE_LABEL.member}</option>
                    <option value="viewer">{ROLE_LABEL.viewer}</option>
                  </select>
                ) : (
                  <span className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}>
                    {ROLE_LABEL[m.role]}
                  </span>
                )}
                {canRemove && (
                  <button
                    onClick={() => removeMember(m.id, m.user.name || m.user.email || 'this member')}
                    disabled={busy === m.id}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Pending invites */}
        {invites.length > 0 && (
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <div className="px-4 py-3 border-b text-[10px] uppercase tracking-wider font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}>
              Pending invitations · {invites.length}
            </div>
            {invites.map(inv => (
              <div key={inv.id} className="flex items-center gap-3 p-4 border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-semibold text-zinc-300">
                  {inv.email.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{inv.email}</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                    {inv.expired
                      ? <span style={{ color: 'var(--accent-red)' }}>Expired</span>
                      : <>Expires {timeAgo(inv.expiresAt)}</>}
                    {inv.inviter && <> · invited by {inv.inviter.name || inv.inviter.email}</>}
                  </p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}>
                  {ROLE_LABEL[inv.role]}
                </span>
                {canManage && (
                  <>
                    <button
                      onClick={() => resendInvite(inv.id)}
                      disabled={busy === inv.id}
                      className="text-xs px-2 py-1 rounded border hover:opacity-80 disabled:opacity-50"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                    >
                      Resend
                    </button>
                    <button
                      onClick={() => cancelInvite(inv.id, inv.email)}
                      disabled={busy === inv.id}
                      className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function prettyStatus(s: string): string {
  switch (s) {
    case 'invited': return 'invitation sent'
    case 'already_member': return 'already a member'
    case 'cross_domain_not_allowed': return 'cross-domain invites require a paid plan'
    case 'error': return 'failed to send'
    default: return s
  }
}

function timeAgo(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  const sign = ms < 0 ? -1 : 1
  const abs = Math.abs(ms)
  const m = Math.round(abs / 60_000)
  if (m < 60) return sign > 0 ? `in ${m}m` : `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return sign > 0 ? `in ${h}h` : `${h}h ago`
  const d = Math.round(h / 24)
  return sign > 0 ? `in ${d}d` : `${d}d ago`
}

function outrankClient(actor: WorkspaceRole | null, target: WorkspaceRole): boolean {
  // Mirror lib/permissions.outranks for client-side gating only —
  // the server is the authoritative gate.
  const rank: Record<WorkspaceRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 }
  if (!actor) return false
  return rank[actor] > rank[target]
}
