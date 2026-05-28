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
import { useEmbedded } from '@/lib/embedded-context'

// Ship dates for the "NEW" badges on recently-added nav items. Add
// entries here when a new feature links off the sidebar; the badge
// auto-expires 90 days after the ship date.
const FEATURE_SHIP_DATES: Record<string, string> = {
  simulations: '2026-04-20',
  integrations: '2026-05-12', // Shopify connector ships today
  toolGate:    '2026-05-30', // Phase B3 enforced-tool gate analytics
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
  const { embedded } = useEmbedded()
  // Recomputed here (the outer component also calculates this for the
  // counts polling key) so the embedded-mode logo link knows where to
  // send the user without prop-drilling.
  const sbMatch = pathname.match(/\/dashboard\/([^\/]+)/)
  const sbStatic = ['settings', 'new', 'feedback']
  const activeWorkspaceId = sbMatch && !sbStatic.includes(sbMatch[1]) ? sbMatch[1] : null
  const [workspaceInfo, setWorkspaceInfo] = useState<{ name: string; icon: string; logoUrl: string | null } | null>(null)
  // True when the active workspace has any Location with crmProvider='native'.
  // Drives the Native CRM nav section (Lists / Imports / Suppressions / Custom fields).
  const [isNative, setIsNative] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  // Caller's role in the active workspace — drives the inbox-only
  // collapse for support-agent role. Null until loaded; sidebar
  // renders the full nav until we know otherwise so admins don't
  // see a flicker of an empty sidebar.
  const [myRole, setMyRole] = useState<string | null>(null)
  // Ticketing visibility — both the plan flag AND the workspace
  // toggle must be on. Single fetch per workspace switch, fails
  // silently to "hide it" so a 5xx never breaks the sidebar.
  const [ticketingActive, setTicketingActive] = useState(false)
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
    if (!workspaceId) { setWorkspaceInfo(null); setIsNative(false); setMyRole(null); setTicketingActive(false); return }
    fetch(`/api/workspaces/${workspaceId}/settings/ticketing`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setTicketingActive(!!d?.status?.active))
      .catch(() => {})
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
          // ws.role is the caller's role in this workspace (the
          // /api/workspaces endpoint already joins WorkspaceMember).
          if (typeof ws.role === 'string') setMyRole(ws.role)
        }
      })
      .catch(() => {})
  }, [workspaceId])

  const isInboxOnly = myRole === 'agent'

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
      {/* Logo. When embedded inside the CRM iframe the user is locked
          to one workspace — the "All Workspaces" picker isn't a
          meaningful destination, so the logo points at the active
          workspace dashboard instead (or is non-interactive if we don't
          have a workspaceId in the path yet). */}
      <div className="px-4 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
        <Link
          href={embedded
            ? (activeWorkspaceId ? `/dashboard/${activeWorkspaceId}` : '#')
            : '/dashboard'}
          className="flex items-center gap-2.5"
        >
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
                {/* Dashboard — the workspace overview page (KPI strip,
                    activity charts, channel + outcome donuts). Lives
                    at the top of the sidebar as the canonical "where
                    am I" landing. Hidden for inbox-only support agents
                    along with everything else below it. */}
                {!isInboxOnly && navItemPrimary(
                  `/dashboard/${workspaceId}`,
                  'Dashboard',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <rect x="3"  y="3"  width="7" height="9" rx="1.5" />
                    <rect x="14" y="3"  width="7" height="5" rx="1.5" />
                    <rect x="14" y="12" width="7" height="9" rx="1.5" />
                    <rect x="3"  y="16" width="7" height="5" rx="1.5" />
                  </svg>,
                )}
                {/* Primary objects — the four things users actually do here.
                    Inbox is the one nav item every role gets; everything
                    after is hidden when the caller is a support-agent
                    role (inbox-only). The `isInboxOnly` guard wraps
                    everything below Inbox. */}
                {navItemPrimary(
                  `/dashboard/${workspaceId}/inbox`,
                  'Inbox',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
                  </svg>,
                  counts.inboxUnread,
                )}
                {!isInboxOnly && (<>
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
                  `/dashboard/${workspaceId}/playground`,
                  'Playground',
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    <path d="M10 9l4 3-4 3z" fill="currentColor" stroke="none" />
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
                    {/* Workspace home is the top-level "Dashboard"
                        primary nav entry now. No duplicate Overview
                        link here. */}

                    {/* ── Activity — what the agents are doing ── */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Activity</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/activity`, 'Live Activity')}
                    {navLink(`/dashboard/${workspaceId}/conversations`, 'Conversations')}
                    {navLink(`/dashboard/${workspaceId}/calls`, 'Calls')}
                    {navLink(`/dashboard/${workspaceId}/logs`, 'Logs')}

                    {/* ── Queue — things needing a human ──
                        Collapsed to a single Queue entry. The unified
                        /queue page already surfaces Needs Attention,
                        Approvals, Next Actions, and Corrections as
                        filterable buckets in one feed — putting them
                        all in the sidebar as separate entries was
                        IA noise. The legacy routes still exist for
                        deep-links / muscle memory, just hidden from
                        the sidebar. */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Queue</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/queue`, 'Queue', counts.needsAttention)}

                    {/* ── Insights — analytics ── */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Insights</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/insights`, 'Insights')}
                    {navLink(`/dashboard/${workspaceId}/insights/retrieval`, '↳ Test your AI')}
                    {navLink(`/dashboard/${workspaceId}/performance`, 'Performance')}
                    {navLink(`/dashboard/${workspaceId}/csat`, 'CSAT')}
                    {navLink(`/dashboard/${workspaceId}/decisions`, 'Decisions')}
                    {navLink(`/dashboard/${workspaceId}/tool-gate`, 'Tool gate', null, FEATURE_SHIP_DATES.toolGate)}
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
                        {ticketingActive && navLink(`/dashboard/${workspaceId}/tickets`, 'Tickets')}
                        {ticketingActive && navLink(`/dashboard/${workspaceId}/tickets/reports`, '↳ Reports')}
                      </>
                    )}

                    {/* ── Library — content the agents pull from ── */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Library</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/knowledge`, 'Knowledge')}
                    {navLink(`/dashboard/${workspaceId}/knowledge-sources`, '↳ Sources & ingestion')}
                    {navLink(`/dashboard/${workspaceId}/templates`, 'Templates')}
                    {navLink(`/dashboard/${workspaceId}/brands`, 'Brands')}
                    {navLink(`/dashboard/${workspaceId}/settings/brand-groups`, '↳ Priority groups')}
                    {/* Widgets promoted to a primary nav item — see the
                        navItemPrimary block at the top. The Library entry
                        used to live here and was buried two levels deep
                        (More → Library → Widgets). */}

                    {/* ── Tools — try it before it ships ──
                        Playground was promoted to primary nav (next to
                        Agent) so it's findable. Simulations stays here
                        until it has the muscle to deserve top-level. */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Tools</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/simulations`, 'Simulations', null, FEATURE_SHIP_DATES.simulations)}

                    {/* ── Workspace — admin & plumbing ── */}
                    <div className="pt-3 pb-1 px-3">
                      <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Workspace</p>
                    </div>
                    {navLink(`/dashboard/${workspaceId}/settings`, 'Settings')}
                    {navLink(`/dashboard/${workspaceId}/settings/members`, 'Members')}
                    {navLink(`/dashboard/${workspaceId}/integrations`, 'Integrations', null, FEATURE_SHIP_DATES.integrations)}
                    {navLink(`/dashboard/${workspaceId}/settings/notifications`, 'Notifications')}
                    {navLink(`/dashboard/${workspaceId}/settings/data-sources`, 'Data sources')}
                    {navLink(`/dashboard/${workspaceId}/settings/integrations`, 'Shared channels')}
                    {navLink(`/dashboard/${workspaceId}/audit-log`, 'Audit Log')}
                    {navLink(`/dashboard/${workspaceId}/consent`, 'Consent')}
                    {navLink(`/dashboard/${workspaceId}/settings/billing`, 'Billing')}
                    {navLink(`/dashboard/${workspaceId}/settings/ticketing`, 'Ticketing')}
                  </div>
                </div>
                </>)}
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
            {embedded ? (
              // Inside the embedded iframe, sign-out is owned by the
              // host CRM (signing out of Voxility while staying signed
              // into the CRM just causes the next iframe load to
              // re-handshake and sign back in).
              // Surface an "Open in new tab" escape hatch instead — gives
              // users a way to reach pages that don't play well inside
              // a third-party iframe (Stripe checkout, OAuth pop-ups).
              <a
                href={activeWorkspaceId ? `/dashboard/${activeWorkspaceId}` : '/dashboard'}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900 transition-colors"
              >
                Open in new tab ↗
              </a>
            ) : (
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-zinc-500 hover:text-red-400 hover:bg-zinc-900 transition-colors"
              >
                Sign out
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
