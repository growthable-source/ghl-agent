'use client'

/**
 * Invite acceptance page.
 *
 * Shows the workspace, inviter, role, and an Accept button. Three
 * states the server tells us about: valid (show details), expired
 * (red banner, "ask for a fresh invite"), already-accepted (deep-link
 * straight into the workspace). If the user isn't signed in, send
 * them through /login first with this page as the callback.
 *
 * The accept POST will hard-reject if the signed-in email doesn't
 * match the invite — we display a friendly mismatch screen in that
 * case with a sign-out + retry option.
 */

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'

interface InviteData {
  ok: true
  invite: {
    email: string
    role: string
    workspace: { id: string; name: string | null; logoUrl: string | null; icon: string | null }
    inviter: { name: string | null; email: string | null } | null
    expiresAt: string
  }
  session: { email: string | null }
}

interface InviteError {
  ok: false
  error: 'invalid' | 'expired' | 'accepted'
  workspaceId?: string
}

type Response = InviteData | InviteError

export default function InviteAcceptPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [data, setData] = useState<Response | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/invite/${token}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData({ ok: false, error: 'invalid' }))
  }, [token])

  async function accept() {
    setAccepting(true)
    setAcceptError(null)
    try {
      const res = await fetch(`/api/invite/${token}/accept`, { method: 'POST' })
      const result = await res.json()
      if (!res.ok) {
        if (result.error === 'not_signed_in') {
          // Bounce through sign-in with the invite page as callback.
          signIn(undefined, { callbackUrl: `/invite/${token}` })
          return
        }
        if (result.error === 'email_mismatch') {
          setAcceptError(
            `You're signed in as ${result.sessionEmail}, but this invitation was sent to ${result.expectedEmail}. Sign out and sign back in with that email to accept.`
          )
          return
        }
        if (result.error === 'expired') {
          setAcceptError('This invitation has expired. Ask the workspace owner to resend it.')
          return
        }
        setAcceptError(result.error || 'Failed to accept invitation.')
        return
      }
      router.push(`/dashboard/${result.workspaceId}`)
    } catch (err: any) {
      setAcceptError(err?.message || 'Failed to accept invitation.')
    } finally {
      setAccepting(false)
    }
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-300">
        <p className="text-sm">Loading invitation…</p>
      </div>
    )
  }

  if (!data.ok) {
    if (data.error === 'accepted' && data.workspaceId) {
      return (
        <Card>
          <h1 className="text-xl font-semibold text-white mb-2">Already accepted</h1>
          <p className="text-sm text-zinc-400 mb-6">You&apos;ve already joined this workspace.</p>
          <button
            onClick={() => router.push(`/dashboard/${data.workspaceId}`)}
            className="text-sm font-semibold px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white"
          >
            Go to workspace
          </button>
        </Card>
      )
    }
    if (data.error === 'expired') {
      return (
        <Card>
          <h1 className="text-xl font-semibold text-white mb-2">Invitation expired</h1>
          <p className="text-sm text-zinc-400">Ask the person who invited you to send a fresh invite.</p>
        </Card>
      )
    }
    return (
      <Card>
        <h1 className="text-xl font-semibold text-white mb-2">Invitation not found</h1>
        <p className="text-sm text-zinc-400">The link is invalid or has been cancelled.</p>
      </Card>
    )
  }

  const { invite, session } = data
  const wsName = invite.workspace.name || 'a Voxility workspace'
  const mismatch = session.email && session.email.toLowerCase() !== invite.email.toLowerCase()

  return (
    <Card>
      <div className="flex items-center gap-3 mb-5">
        {invite.workspace.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={invite.workspace.logoUrl} alt="" className="w-12 h-12 rounded-lg object-cover" />
        ) : (
          <div className="w-12 h-12 rounded-lg bg-orange-500/15 text-orange-400 flex items-center justify-center text-xl">
            {invite.workspace.icon || '🚀'}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Invitation</p>
          <h1 className="text-lg font-semibold text-white truncate">Join {wsName}</h1>
        </div>
      </div>

      <p className="text-sm text-zinc-300 mb-4">
        {invite.inviter
          ? <>{invite.inviter.name || invite.inviter.email} invited you </>
          : <>You&apos;ve been invited </>}
        as a <span className="font-semibold text-white">{invite.role}</span> on {wsName}.
      </p>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 mb-5">
        <p className="text-[11px] text-zinc-500">Invited email</p>
        <p className="text-sm font-mono text-zinc-200">{invite.email}</p>
      </div>

      {mismatch && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 mb-4">
          <p className="text-xs text-amber-300">
            You&apos;re signed in as <span className="font-mono">{session.email}</span>. Sign out
            and sign back in as <span className="font-mono">{invite.email}</span> to accept.
          </p>
        </div>
      )}

      {acceptError && (
        <p className="text-xs text-red-400 mb-3">{acceptError}</p>
      )}

      <button
        onClick={accept}
        disabled={accepting}
        className="w-full text-sm font-semibold px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
      >
        {accepting ? 'Accepting…' : session.email ? 'Accept invitation' : 'Sign in to accept'}
      </button>

      <p className="text-[10px] text-zinc-600 text-center mt-3">
        Expires {timeUntil(invite.expiresAt)}
      </p>
    </Card>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 p-6">
      <div className="w-full max-w-sm rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl">
        {children}
      </div>
    </div>
  )
}

function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms < 0) return 'already expired'
  const m = Math.round(ms / 60_000)
  if (m < 60) return `in ${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `in ${h}h`
  return `in ${Math.round(h / 24)}d`
}
