'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import VoxilityLogo from '@/components/VoxilityLogo'
import { NavCountsProvider, useNavCounts, NavBadge } from './useNavCounts'
import WorkspaceAvatar from './WorkspaceAvatar'
import CannyChangelogButton from '@/components/CannyChangelogButton'
import NewBadge from '@/components/NewBadge'

// Ship dates for the "NEW" badges on recently-added nav items. Add
// entries here when a new feature links off the sidebar; the badge
// auto-expires 90 days after the ship date.
const FEATURE_SHIP_DATES: Record<string, string> = {
  simulations: '2026-04-20',
  integrations: '2026-05-12', // Shopify connector ships today
}

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
  const [workspaceInfo, setWorkspaceInfo] = useState<{ name: string; icon: string; logoUrl: string | null } | null>(null)
  // True when the active workspace has any Location with crmProvider='native'.
  // Drives the Native CRM nav section (Lists / Imports / Suppressions / Custom fields).
  const [isNative, setIsNative] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  // Manual disclosure for the "More" section. We previously used
  // <details>/<summary> but Safari drops the click handler when
  // <summary> is styled with display:flex, which made the button
  // unclickable for some users. Plain button + state is bulletproof.
  const [moreOpen, setMoreOpen] = useState(false)

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
    if (!workspaceId) { setWorkspaceInfo(null); setIsNative(false); return }
    fetch('/api/workspaces')
      .then(r => r.json())
      .then(data => {
        const ws = data.workspaces?.find((w: any) => w.id === workspaceId)
        if (ws) {
          setWorkspaceInfo({
            name: ws.name,
            icon: ws.icon || '🚀',
            logoUrl: ws.logoUrl ?? null,
          })
          setIsNative(Array.isArray(ws.locations) && ws.locations.some((l: any) => l.crmProvider === 'native'))
        }
      })
      .catch(() => {})
  }, [workspaceId])

  // Don't show location nav for these sub-pages
  const isOnboarding = pathname.includes('/onboarding')

  if (isOnboarding) return null

  function navLink(href: string, label: string, badgeCount?: number | null, newSince?: string) {
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
        {newSince && <NewBadge since={newSince} />}
        <NavBadge count={badgeCount} />
      </Link>
    )
  }

  function navItemPrimary(
    href: string,
    label: string,
    icon: React.ReactNode,
    badgeCount?: number | null
  ) {
    const active = pathname === href || pathname.startsWith(href + '/') || pathname === href
    return (
      <Link
        href={href}
        className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
          active ? '' : 'text-zinc-400 hover:text-white hover:bg-zinc-900'
        }`}
        style={active ? { background: 'rgba(250,77,46,0.12)', color: '#fa4d2e' } : undefined}
      >
        <span className="shrink-0 w-[18px] h-[18px] flex items-center justify-center">{icon}</span>
        <span className="flex-1 truncate font-medium">{label}</span>
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
              <WorkspaceAvatar
                logoUrl={workspaceInfo?.logoUrl}
                icon={workspaceInfo?.icon}
                size={20}
                title={workspaceInfo?.name || workspaceId}
              />
              <p className="text-xs text-zinc-400 font-medium truncate" title={workspaceInfo?.name || workspaceId}>
                {workspaceInfo?.name || 'Workspace'}
              </p>
            </div>
            {!isOnboarding && (
              <>
                {/* Primary objects — the four things users actually do here */}
                {navItemPrimary(
                  `/dashboard/${workspaceId}/inbox`,
                  'Inbox',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
                  </svg>,
                  counts.inboxUnread,
                )}
                {navItemPrimary(
                  `/dashboard/${workspaceId}/contacts`,
                  'Contacts',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>,
                )}
                {navItemPrimary(
                  `/dashboard/${workspaceId}/agents`,
                  'Agent',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
                    <circle cx="12" cy="12" r="3.5" />
                  </svg>,
                )}
                {navItemPrimary(
                  `/dashboard/${workspaceId}/funnels`,
                  'Funnels',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <path d="M3 4h18l-7 9v6l-4 2v-8z" />
                  </svg>,
                )}
                {navItemPrimary(
                  `/dashboard/${workspaceId}/ads`,
                  'Ads',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <path d="M3 11l18-8v18l-18-8z" />
                    <path d="M11.6 16.8L13 21" />
                  </svg>,
                )}
                {navItemPrimary(
                  `/dashboard/${workspaceId}/channels`,
                  'Channels',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                  </svg>,
                )}
                {navItemPrimary(
                  `/dashboard/${workspaceId}/widgets`,
                  'Widgets',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                  </svg>,
                )}

                {/* Everything else, demoted out of primary nav and
                    grouped into mental hubs that mirror the agent
                    sidebar (Activity / Queue / Insights / Library /
                    Tools / Workspace). The kitchen-sink "Tools" group
                    that used to mix Playground with Knowledge with
                    Logs is gone — each item now lives under the heading
                    that best describes its job. */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setMoreOpen(o => !o)}
                    aria-expanded={moreOpen}
                    className="cursor-pointer w-full flex items-center justify-between px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold transition-colors hover:bg-zinc-900"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    <span>More</span>
                    <span
                      className="transition-transform"
                      style={{ color: 'var(--text-muted)', transform: moreOpen ? 'rotate(90deg)' : undefined }}
                    >
                      ›
                    </span>
                  </button>
                  <div
                    className="mt-1 space-y-0.5"
                    style={{ display: moreOpen ? undefined : 'none' }}
                  >
                    {/* Workspace home — overview dashboard. Kept at the
                        top because it's the canonical "where am I"
                        landing. */}
                    {navLink(`/dashboard/${workspaceId}`, 'Overview')}

                    {/* ── Activity — what the agents are doing ── */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Activity</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/activity`, 'Live Activity')}
                    {navLink(`/dashboard/${workspaceId}/conversations`, 'Conversations')}
                    {navLink(`/dashboard/${workspaceId}/calls`, 'Calls')}
                    {navLink(`/dashboard/${workspaceId}/logs`, 'Logs')}

                    {/* ── Queue — things needing a human ──
                        Unified "Queue" page is the new top-of-list
                        entry; the four legacy buckets are kept as
                        filter shortcuts beneath. We'll collapse those
                        away in a future pass once operators have
                        actually adopted the unified view; until then,
                        no breaking-change to anyone's muscle memory. */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Queue</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/queue`, 'Queue', counts.needsAttention)}
                    {navLink(`/dashboard/${workspaceId}/needs-attention`, '↳ Needs Attention', counts.needsAttention)}
                    {navLink(`/dashboard/${workspaceId}/approvals`, '↳ Approvals', counts.approvalsPending)}
                    {navLink(`/dashboard/${workspaceId}/next-actions`, '↳ Next Actions')}
                    {navLink(`/dashboard/${workspaceId}/corrections`, '↳ Corrections')}

                    {/* ── Insights — analytics ── */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Insights</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/insights`, 'Insights')}
                    {navLink(`/dashboard/${workspaceId}/performance`, 'Performance')}
                    {navLink(`/dashboard/${workspaceId}/csat`, 'CSAT')}
                    {navLink(`/dashboard/${workspaceId}/decisions`, 'Decisions')}
                    {navLink(`/dashboard/${workspaceId}/digest`, 'Weekly Digest')}

                    {/* ── Native CRM (only when workspace is on the built-in CRM) ── */}
                    {isNative && (
                      <>
                        <div className="pt-3 pb-1 px-3">
                          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Native CRM</p>
                        </div>
                        {navLink(`/dashboard/${workspaceId}/lists`, 'Lists')}
                        {navLink(`/dashboard/${workspaceId}/imports`, 'Imports')}
                        {navLink(`/dashboard/${workspaceId}/suppressions`, 'Suppressions')}
                        {navLink(`/dashboard/${workspaceId}/custom-fields`, 'Custom fields')}
                      </>
                    )}

                    {/* ── Library — content the agents pull from ── */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Library</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/knowledge`, 'Knowledge')}
                    {navLink(`/dashboard/${workspaceId}/templates`, 'Templates')}
                    {navLink(`/dashboard/${workspaceId}/brands`, 'Brands')}
                    {/* Widgets promoted to a primary nav item — see the
                        navItemPrimary block at the top. The Library entry
                        used to live here and was buried two levels deep
                        (More → Library → Widgets). */}

                    {/* ── Tools — try it before it ships ── */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Tools</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/playground`, 'Playground')}
                    {navLink(`/dashboard/${workspaceId}/simulations`, 'Simulations', null, FEATURE_SHIP_DATES.simulations)}

                    {/* ── Workspace — admin & plumbing ── */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Workspace</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/settings`, 'Settings')}
                    {navLink(`/dashboard/${workspaceId}/integrations`, 'Integrations', null, FEATURE_SHIP_DATES.integrations)}
                    {navLink(`/dashboard/${workspaceId}/settings/notifications`, 'Notifications')}
                    {navLink(`/dashboard/${workspaceId}/settings/data-sources`, 'Data sources')}
                    {navLink(`/dashboard/${workspaceId}/settings/integrations`, 'Shared channels')}
                    {navLink(`/dashboard/${workspaceId}/audit-log`, 'Audit Log')}
                    {navLink(`/dashboard/${workspaceId}/consent`, 'Consent')}
                    {navLink(`/dashboard/${workspaceId}/settings/billing`, 'Billing')}
                  </div>
                </div>
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
            Merge Fields Reference
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
        {/* What's new — opens Canny changelog popover with an unread
            badge. Sits above Feedback so users see the updates first. */}
        <CannyChangelogButton />
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
