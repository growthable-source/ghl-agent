'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import * as Lucide from 'lucide-react'
import { signOut } from 'next-auth/react'
import XoveraLogo from '@/components/XoveraLogo'
import { NavCountsProvider, useNavCounts, NavBadge } from './useNavCounts'
import WorkspaceAvatar from './WorkspaceAvatar'
import CannyChangelogButton from '@/components/CannyChangelogButton'
import NewBadge from '@/components/NewBadge'
import { useEmbedded } from '@/lib/embedded-context'
import { NAV_ITEMS, NAV_GROUP_LABELS, activeNavItem, type NavGroupKey, type NavItem } from '@/lib/dashboard-nav'
import { Avatar, SectionLabel } from '@/components/ui/primitives'

// Plain-language hover hints for nav entries whose label is a product
// term a first-time user wouldn't recognise. Keyed by href suffix
// (matched with endsWith), so they apply wherever the route renders.
// This is the no-risk half of the learning-curve work: explain the
// jargon without renaming routes. Primary-nav labels stay self-evident.
const NAV_HINTS: Record<string, string> = {
  '/csat': 'Customer satisfaction — how people rated their conversations',
  '/insights': 'How your agents are performing overall',
  '/performance': 'Response times, resolution rates, and volume over time',
  '/digest': 'A weekly email-style summary of agent activity',
  '/simulations': 'Stress-test an agent against many synthetic customers at once',
  '/playground': 'Chat with an agent live to try it out',
  '/knowledge': 'Everything your agents have learned — websites, files, feeds, notes',
  '/knowledge-sources': 'Advanced: organise knowledge into topics and review indexing',
  '/consent': 'Opt-in / opt-out records for messaging compliance',
  '/audit-log': 'A record of who changed what in this workspace',
  '/settings/data-sources': 'Live data the agent can look up mid-conversation (Sheets, Airtable, APIs)',
  '/settings/integrations': 'Channels shared across your workspaces',
  '/integrations': 'Connect your CRM, Shopify, Meta, and other tools',
  '/brands': 'Per-brand voice, colours, and styling for whitelabel clients',
  '/settings/brand-groups': 'Group brands so agents prioritise the right knowledge',
}

// Ship dates for the "NEW" badges on recently-added nav items. Add
// entries here when a new feature links off the sidebar; the badge
// auto-expires 90 days after the ship date.
const FEATURE_SHIP_DATES: Record<string, string> = {
  simulations: '2026-04-20',
  integrations: '2026-05-12', // Shopify connector ships today
  gettingStarted: '2026-05-29', // First-run guide for newly-installed workspaces
  voiceAgents: '2026-06-06', // Voice agents promoted to their own top-level section
  copilot: '2026-06-10', // Real-time screen-share Co-Pilot (v0, behind plan gate)
  apiAccess: '2026-06-24', // API Access settings page (support-metrics connector)
  slaPolicies: '2026-06-24', // SLA Policies settings page (support-metrics connector)
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
  const [userName, setUserName] = useState<string | null>(null)
  // Caller's role in the active workspace — drives the inbox-only
  // collapse for support-agent role. Null until loaded; sidebar
  // renders the full nav until we know otherwise so admins don't
  // see a flicker of an empty sidebar.
  const [myRole, setMyRole] = useState<string | null>(null)
  // Ticketing visibility — both the plan flag AND the workspace
  // toggle must be on. Single fetch per workspace switch, fails
  // silently to "hide it" so a 5xx never breaks the sidebar.
  const [ticketingActive, setTicketingActive] = useState(false)

  useEffect(() => {
    // Cheap check — is the signed-in user a Xovera super-admin? If yes
    // we render an extra "Help Center · Admin" entry near the bottom.
    fetch('/api/me/super')
      .then(r => r.json())
      .then(d => setIsSuperAdmin(!!d.isSuperAdmin))
      .catch(() => {})
    // Pull the current session's email so users can see which account
    // they're signed in as (and confirm a re-sign-in took effect).
    fetch('/api/auth/session')
      .then(r => r.json())
      .then(s => { setUserEmail(s?.user?.email ?? null); setUserName(s?.user?.name ?? null) })
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

  const icons = Lucide as unknown as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>
  const current = workspaceId ? activeNavItem(pathname, workspaceId) : null
  const onSettings = !!workspaceId && pathname.startsWith(`/dashboard/${workspaceId}/settings`) && !current

  // Hover hints for jargon-y entries (kept from the previous sidebar).
  function hintFor(item: NavItem) {
    const key = Object.keys(NAV_HINTS).find(k => item.path.endsWith(k))
    return key ? NAV_HINTS[key] : undefined
  }

  const shipDate: Record<string, string> = {
    'voice-agents': FEATURE_SHIP_DATES.voiceAgents,
    copilot: FEATURE_SHIP_DATES.copilot,
    integrations: FEATURE_SHIP_DATES.integrations,
  }

  function gateOpen(item: NavItem) {
    if (item.gate === 'native-crm') return isNative
    if (item.gate === 'ticketing') return ticketingActive
    return true
  }

  const rowBase = 'flex items-center gap-2.5 h-[30px] px-2.5 rounded-md text-[13px] transition-colors'
  const rowIdle = 'text-text-secondary hover:bg-surface-secondary hover:text-text-primary'
  // Active = white + ring + brand icon (handoff AppSidebar spec).
  const rowActive = 'bg-surface text-text-primary font-medium shadow-sm ring-1 ring-border-theme'

  function renderItem(item: NavItem) {
    if (!workspaceId) return null
    const Icon = icons[item.icon]
    const active = current?.key === item.key
    const count = item.badge ? counts[item.badge] : null
    return (
      <Link
        key={item.key}
        href={`/dashboard/${workspaceId}${item.path}`}
        title={hintFor(item)}
        aria-current={active ? 'page' : undefined}
        className={`${rowBase} ${active ? rowActive : rowIdle}`}
      >
        {Icon && <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? 'text-brand-500' : 'text-text-tertiary'}`} strokeWidth={1.7} />}
        <span className="flex-1 truncate">{item.label}</span>
        {shipDate[item.key] && <NewBadge since={shipDate[item.key]} />}
        {/* TODO(redesign-followup): amber "integration issue" dot on Integrations once a connection-health signal is exposed to the sidebar. */}
        {item.badge === 'needsAttention' || item.badge === 'inboxUnread'
          ? <NavBadge count={count} />
          : null}
      </Link>
    )
  }

  const GROUP_ORDER: NavGroupKey[] = ['top', 'agents', 'deploy', 'insights', 'data']
  const visible = NAV_ITEMS.filter(gateOpen)
  // Support-agent role is inbox-only (+ Tickets when ticketing is on).
  const itemsForRole = isInboxOnly
    ? visible.filter(i => i.key === 'inbox' || i.key === 'tickets')
    : visible

  const footerRow = `${rowBase} ${rowIdle} text-[13px]`
  const displayName = userName || userEmail || 'Account'

  return (
    <div className="hidden md:flex w-[236px] shrink-0 border-r border-sidebar-border flex-col h-full bg-sidebar-bg">
      {/* Workspace switcher. When embedded inside the CRM iframe the user is
          locked to one workspace, so the switcher points at the active
          workspace dashboard instead of the "All workspaces" picker. */}
      <div className="px-3 pt-3.5 pb-2">
        <Link
          href={embedded
            ? (activeWorkspaceId ? `/dashboard/${activeWorkspaceId}` : '#')
            : '/dashboard'}
          title={embedded ? undefined : 'Switch workspace'}
          className="flex items-center gap-2.5 px-1.5 py-1 rounded-lg hover:bg-surface-secondary transition-colors"
        >
          {workspaceId ? (
            <WorkspaceAvatar
              logoUrl={workspaceInfo?.logoUrl}
              icon={workspaceInfo?.icon}
              size={32}
              title={workspaceInfo?.name || workspaceId}
            />
          ) : (
            <XoveraLogo variant="mark" height={30} />
          )}
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold text-text-primary truncate">
              {workspaceId ? (workspaceInfo?.name || 'Workspace') : 'Xovera'}
            </span>
            {/* TODO(redesign-followup): "<plan> · Xovera" subtitle once the plan name is on /api/workspaces. */}
            <span className="block text-[11px] text-text-tertiary truncate">
              {workspaceId ? 'Xovera' : 'All workspaces'}
            </span>
          </span>
          {!embedded && <Lucide.ChevronsUpDown className="w-3.5 h-3.5 text-text-muted shrink-0" />}
        </Link>
      </div>

      {/* ⌘K search — visual placeholder. */}
      {workspaceId && (
        <div className="px-3 pb-2">
          {/* TODO(redesign-followup): wire to a ⌘K command palette; none exists yet, so this is intentionally non-interactive. */}
          <div
            aria-hidden
            className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-border-theme bg-surface text-[12.5px] text-text-muted select-none"
          >
            <Lucide.Search className="w-3.5 h-3.5" />
            <span className="flex-1">Search or jump to…</span>
            <kbd className="rounded bg-surface-secondary px-1 text-[10px] text-text-tertiary">⌘K</kbd>
          </div>
        </div>
      )}

      <nav className="flex-1 px-3 pb-2 overflow-y-auto">
        {!workspaceId || workspaceId === 'undefined' ? (
          <Link href="/dashboard" className={`${rowBase} ${pathname === '/dashboard' ? rowActive : rowIdle}`}>
            <Lucide.LayoutGrid className="w-[17px] h-[17px] text-text-tertiary" strokeWidth={1.7} />
            All workspaces
          </Link>
        ) : (
          GROUP_ORDER.map(group => {
            const items = itemsForRole.filter(i => i.group === group)
            if (items.length === 0) return null
            const label = NAV_GROUP_LABELS[group]
            return (
              <div key={group} className={label ? 'mt-4' : 'mt-1'}>
                {label && <SectionLabel className="px-2.5 pb-1.5">{label}</SectionLabel>}
                <div className="space-y-0.5">{items.map(renderItem)}</div>
              </div>
            )
          })
        )}
      </nav>

      {/* Footer: Settings / Help / user */}
      <div className="px-3 pt-2 pb-3 border-t border-sidebar-border space-y-0.5">
        {workspaceId && !isInboxOnly && (
          <Link
            href={`/dashboard/${workspaceId}/settings`}
            className={`${rowBase} ${onSettings ? rowActive : rowIdle}`}
            aria-current={onSettings ? 'page' : undefined}
          >
            <Lucide.Settings className={`w-[17px] h-[17px] ${onSettings ? 'text-brand-500' : 'text-text-tertiary'}`} strokeWidth={1.7} />
            Settings
          </Link>
        )}
        <Link href="/help" target="_blank" className={footerRow}>
          <Lucide.CircleHelp className="w-[17px] h-[17px] text-text-tertiary" strokeWidth={1.7} />
          <span className="flex-1">Help &amp; docs</span>
          <span className="text-text-muted text-[10px]">↗</span>
        </Link>
        {workspaceId && !isInboxOnly && (
          <Link
            href={`/dashboard/${workspaceId}/help`}
            className={`${rowBase} text-[12px] ${pathname.startsWith(`/dashboard/${workspaceId}/help`) ? rowActive : rowIdle}`}
          >
            <span className="w-[17px]" />
            Merge fields reference
          </Link>
        )}
        {isSuperAdmin && (
          <Link
            href="/dashboard/help-admin"
            className={`${rowBase} text-[12px] ${pathname.startsWith('/dashboard/help-admin') ? rowActive : rowIdle}`}
          >
            <span className="w-[17px]" />
            Help Center · Admin
          </Link>
        )}
        <CannyChangelogButton />
        <a href="https://xovera.canny.io" target="_blank" rel="noopener noreferrer" className={`${rowBase} text-[12px] ${rowIdle}`}>
          <span className="w-[17px]" />
          <span className="flex-1">Feedback</span>
          <span className="text-text-muted text-[10px]">↗</span>
        </a>
        <Link
          href="/dashboard/settings"
          className={`${rowBase} text-[12px] ${pathname === '/dashboard/settings' ? rowActive : rowIdle}`}
        >
          <span className="w-[17px]" />
          Profile
        </Link>

        {/* Signed-in-as + sign out. Showing the account here is how users
            verify their session reflects the Google account they meant to
            use (a second account while still holding the first session
            cookie has confused people before). */}
        {userEmail && (
          <div className="pt-2 mt-1 border-t border-sidebar-border">
            <div className="flex items-center gap-2.5 px-1.5 py-1.5" title={userEmail}>
              <Avatar name={displayName} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-text-primary truncate">{displayName}</span>
                {userName && <span className="block text-[11px] text-text-tertiary truncate">{userEmail}</span>}
              </span>
            </div>
            {embedded ? (
              // Inside the embedded iframe, sign-out is owned by the host CRM
              // (signing out of Xovera while staying signed into the CRM just
              // causes the next iframe load to re-handshake and sign back in).
              // "Open in new tab" is the escape hatch for pages that don't
              // play well inside a third-party iframe (Stripe, OAuth pop-ups).
              <a
                href={activeWorkspaceId ? `/dashboard/${activeWorkspaceId}` : '/dashboard'}
                target="_blank"
                rel="noopener noreferrer"
                className={`${rowBase} text-[12px] ${rowIdle}`}
              >
                Open in new tab ↗
              </a>
            ) : (
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/login' })}
                className={`${rowBase} w-full text-left text-[12px] ${rowIdle} hover:!text-red-600 cursor-pointer`}
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
