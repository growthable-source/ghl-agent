'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import VoxilityLogo from '@/components/VoxilityLogo'
import { NavCountsProvider, useNavCounts, NavBadge } from './useNavCounts'

export default function DashboardSidebar() {
  const pathname = usePathname()
  // Extract workspaceId up front so the counts-provider can scope its
  // polling. We still compute it again inside the inner component for
  // the nav-link construction because the logic there handles static
  // routes like /dashboard/settings.
  const preMatch = pathname.match(/\/dashboard\/([^\/]+)/)
  const STATIC = ['settings', 'new', 'feedback']
  const pollingWorkspaceId = preMatch && !STATIC.includes(preMatch[1]) ? preMatch[1] : null

  return (
    <NavCountsProvider workspaceId={pollingWorkspaceId}>
      <SidebarBody />
    </NavCountsProvider>
  )
}

function SidebarBody() {
  const pathname = usePathname()
  const counts = useNavCounts()
  const [workspaceInfo, setWorkspaceInfo] = useState<{ name: string; icon: string } | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    // Cheap check — is the signed-in user a Voxility super-admin? If yes
    // we render an extra "Help Center · Admin" entry near the bottom.
    fetch('/api/me/super')
      .then(r => r.json())
      .then(d => setIsSuperAdmin(!!d.isSuperAdmin))
      .catch(() => {})
    // Pull the current session's email so users can see which account
    // they're signed in as (and confirm a re-sign-in took effect).
    fetch('/api/auth/session')
      .then(r => r.json())
      .then(s => setUserEmail(s?.user?.email ?? null))
      .catch(() => {})
  }, [])

  // Extract workspaceId from path — exclude known static routes
  const STATIC_ROUTES = ['settings', 'new', 'feedback']
  const match = pathname.match(/\/dashboard\/([^\/]+)/)
  const rawSegment = match ? match[1] : null
  const workspaceId = rawSegment && !STATIC_ROUTES.includes(rawSegment) ? rawSegment : null

  useEffect(() => {
    if (!workspaceId) { setWorkspaceInfo(null); return }
    fetch('/api/workspaces')
      .then(r => r.json())
      .then(data => {
        const ws = data.workspaces?.find((w: any) => w.id === workspaceId)
        if (ws) setWorkspaceInfo({ name: ws.name, icon: ws.icon || '🚀' })
      })
      .catch(() => {})
  }, [workspaceId])

  // Don't show location nav for these sub-pages
  const isOnboarding = pathname.includes('/onboarding')

  if (isOnboarding) return null

  function navLink(href: string, label: string, badgeCount?: number | null) {
    const active = pathname === href || (href !== `/dashboard/${workspaceId}` && pathname.startsWith(href))
    return (
      <Link
        href={href}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
          active
            ? 'text-white'
            : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
        }`}
        style={active ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
      >
        <span className="flex-1 truncate">{label}</span>
        <NavBadge count={badgeCount} />
      </Link>
    )
  }

  return (
    <div className="hidden md:flex w-56 shrink-0 border-r border-sidebar-border flex-col h-full bg-sidebar-bg">
      {/* Logo */}
      <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <VoxilityLogo variant="mark" height={26} />
          <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Voxility</span>
        </Link>
      </div>

      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {!workspaceId || workspaceId === 'undefined' ? (
          // Top-level nav
          <>
            {navLink('/dashboard', 'All Workspaces')}
          </>
        ) : (
          // Workspace-level nav
          <>
            <div className="px-3 py-1.5 mb-1 flex items-center gap-2">
              <span className="text-base">{workspaceInfo?.icon || '🚀'}</span>
              <p className="text-xs text-zinc-400 font-medium truncate" title={workspaceInfo?.name || workspaceId}>
                {workspaceInfo?.name || 'Workspace'}
              </p>
            </div>
            {!isOnboarding && (
              <>
                {navLink(`/dashboard/${workspaceId}`, 'Overview')}
                {navLink(`/dashboard/${workspaceId}/agents`, 'Agents')}
                {navLink(`/dashboard/${workspaceId}/templates`, 'Templates')}
                {navLink(`/dashboard/${workspaceId}/widgets`, 'Chat Widgets')}
                {navLink(`/dashboard/${workspaceId}/inbox`, 'Inbox')}
                {navLink(`/dashboard/${workspaceId}/activity`, 'Live Activity')}
                {navLink(`/dashboard/${workspaceId}/routing-diagnostic`, 'Routing Diagnostic')}
                {navLink(`/dashboard/${workspaceId}/needs-attention`, 'Needs Attention', counts.needsAttention)}
                {navLink(`/dashboard/${workspaceId}/next-actions`, 'Next Actions')}
                {navLink(`/dashboard/${workspaceId}/approvals`, 'Approvals', counts.approvalsPending)}

                <div className="pt-2 pb-1 px-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">Insights</p>
                </div>
                {navLink(`/dashboard/${workspaceId}/insights`, 'Insights')}
                {navLink(`/dashboard/${workspaceId}/performance`, 'Performance')}
                {navLink(`/dashboard/${workspaceId}/decisions`, 'Decisions')}
                {navLink(`/dashboard/${workspaceId}/digest`, 'Weekly Digest')}
                {navLink(`/dashboard/${workspaceId}/corrections`, 'Corrections')}

                <div className="pt-2 pb-1 px-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">Tools</p>
                </div>
                {navLink(`/dashboard/${workspaceId}/playground`, 'Playground')}
                {navLink(`/dashboard/${workspaceId}/logs`, 'Logs')}
                {navLink(`/dashboard/${workspaceId}/conversations`, 'Conversations')}
                {navLink(`/dashboard/${workspaceId}/calls`, 'Calls')}
                {navLink(`/dashboard/${workspaceId}/integrations`, 'Integrations')}

                <div className="pt-2 pb-1 px-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">Trust</p>
                </div>
                {navLink(`/dashboard/${workspaceId}/audit-log`, 'Audit Log')}
                {navLink(`/dashboard/${workspaceId}/consent`, 'Consent')}

                <div className="pt-2 pb-1 px-3">
                  <p className="text-[10px] uppercase tracking-wider text-zinc-600 font-semibold">Account</p>
                </div>
                {navLink(`/dashboard/${workspaceId}/settings`, 'Settings')}
                {navLink(`/dashboard/${workspaceId}/settings/integrations`, 'Notifications')}
                {navLink(`/dashboard/${workspaceId}/settings/billing`, 'Billing')}
              </>
            )}
          </>
        )}
      </nav>

      {/* Bottom */}
      <div className="p-3 border-t border-zinc-800 space-y-0.5">
        <Link
          href="/help"
          target="_blank"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          Help Center
          <span className="text-zinc-700 text-[10px]">↗</span>
        </Link>
        {workspaceId && workspaceId !== 'undefined' && (
          <Link
            href={`/dashboard/${workspaceId}/help`}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
              pathname.startsWith(`/dashboard/${workspaceId}/help`)
                ? ''
                : 'text-zinc-500 hover:text-white hover:bg-zinc-900'
            }`}
            style={pathname.startsWith(`/dashboard/${workspaceId}/help`) ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
          >
            Feature reference
          </Link>
        )}
        {isSuperAdmin && (
          <Link
            href="/dashboard/help-admin"
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
              pathname.startsWith('/dashboard/help-admin')
                ? ''
                : 'text-zinc-500 hover:text-white hover:bg-zinc-900'
            }`}
            style={pathname.startsWith('/dashboard/help-admin') ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
          >
            Help Center · Admin
          </Link>
        )}
        <a
          href="https://voxility.canny.io"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors"
        >
          Feedback
          <span className="text-zinc-700 text-[10px]">↗</span>
        </a>
        <Link
          href="/dashboard/settings"
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors ${
            pathname === '/dashboard/settings'
              ? ''
              : 'text-zinc-500 hover:text-white hover:bg-zinc-900'
          }`}
          style={pathname === '/dashboard/settings' ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
        >
          Profile
        </Link>
        <Link
          href="/dashboard"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-white transition-colors"
        >
          ← All Workspaces
        </Link>

        {/* Signed-in-as + sign out. Showing the email here is how users
            verify their session reflects the Google account they meant to
            use — earlier users hit confusion signing in with a second
            Google account while still holding the first session cookie. */}
        {userEmail && (
          <div className="pt-2 mt-1 border-t border-zinc-800 space-y-0.5">
            <div className="px-3 py-1.5 text-[10px] text-zinc-600 truncate" title={userEmail}>
              {userEmail}
            </div>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-red-400 hover:bg-zinc-900 transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
