/**
 * Dashboard navigation map (UI redesign handoff §3).
 *
 * The redesign REGROUPS the sidebar; it does not rename URLs. Several new
 * sidebar entries stand in for what used to be separate pages
 * ("Live ops & queue" = activity + queue + logs, …). Phase 5 will fold
 * those into real tabs/sub-navs on one page; until then every legacy page
 * must stay reachable, so each nav item lists its `pages` — the sidebar
 * highlights the item for any of them and the top bar renders them as a
 * sibling-tab strip (see `siblingsFor`).
 *
 * Pure data + helpers, no React: unit-tested in lib/dashboard-nav.test.ts.
 */

export type NavGroupKey = 'top' | 'agents' | 'deploy' | 'insights' | 'data'

/** Optional gate resolved by the sidebar from data it already loads. */
// 'whitelabel' = may manage white-label (owner / platform admin,
// lib/whitelabel/manage-policy.ts); hidden entirely from everyone else.
export type NavGate = 'native-crm' | 'ticketing' | 'whitelabel'

export interface NavPage {
  /** Path suffix after /dashboard/<ws> ('' = workspace root). */
  path: string
  label: string
  gate?: NavGate
}

export interface NavItem {
  key: string
  label: string
  group: NavGroupKey
  /** Where the sidebar link goes (suffix after /dashboard/<ws>). */
  path: string
  /** Lucide icon name — resolved in the sidebar. */
  icon: string
  /** Which live-count (useNavCounts) drives the badge, if any. */
  badge?: 'inboxUnread' | 'needsAttention'
  gate?: NavGate
  /** Every page this item stands for; first is the default landing. */
  pages: NavPage[]
}

export const NAV_GROUP_LABELS: Record<NavGroupKey, string | null> = {
  top: null,
  agents: 'Agents',
  deploy: 'Deploy',
  insights: 'Insights',
  data: 'Data',
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard', group: 'top', path: '', icon: 'House', pages: [{ path: '', label: 'Overview' }] },
  { key: 'inbox', label: 'Inbox', group: 'top', path: '/inbox', icon: 'Inbox', badge: 'inboxUnread', pages: [{ path: '/inbox', label: 'Inbox' }] },
  { key: 'contacts', label: 'Contacts', group: 'top', path: '/contacts', icon: 'Users', pages: [{ path: '/contacts', label: 'Contacts' }] },

  { key: 'text-agents', label: 'Text agents', group: 'agents', path: '/agents', icon: 'MessageSquare', pages: [{ path: '/agents', label: 'Text agents' }] },
  { key: 'voice-agents', label: 'Voice agents', group: 'agents', path: '/voice', icon: 'Phone', pages: [{ path: '/voice', label: 'Voice agents' }] },
  { key: 'copilot', label: 'Co-Pilot', group: 'agents', path: '/copilot', icon: 'Sparkles', pages: [{ path: '/copilot', label: 'Co-Pilot' }] },
  { key: 'playground', label: 'Playground', group: 'agents', path: '/playground', icon: 'Play', pages: [{ path: '/playground', label: 'Playground' }, { path: '/simulations', label: 'Simulations' }] },

  { key: 'channels', label: 'Channels', group: 'deploy', path: '/channels', icon: 'Rss', pages: [{ path: '/channels', label: 'Channels' }] },
  { key: 'widgets', label: 'Widgets', group: 'deploy', path: '/widgets', icon: 'LayoutGrid', pages: [{ path: '/widgets', label: 'Widgets' }] },
  { key: 'integrations', label: 'Integrations', group: 'deploy', path: '/integrations', icon: 'Plug', pages: [{ path: '/integrations', label: 'Integrations' }] },

  { key: 'conversations', label: 'Conversations & calls', group: 'insights', path: '/conversations', icon: 'ChartLine', pages: [{ path: '/conversations', label: 'Conversations' }, { path: '/calls', label: 'Calls' }] },
  {
    key: 'live-ops', label: 'Live ops & queue', group: 'insights', path: '/queue', icon: 'Zap', badge: 'needsAttention',
    pages: [
      { path: '/queue', label: 'Queue' }, { path: '/activity', label: 'Live activity' }, { path: '/logs', label: 'Logs' },
      { path: '/needs-attention', label: 'Needs attention' }, { path: '/approvals', label: 'Approvals' },
      { path: '/next-actions', label: 'Next actions' }, { path: '/corrections', label: 'Corrections' },
    ],
  },
  {
    key: 'performance', label: 'Performance & CSAT', group: 'insights', path: '/performance', icon: 'Gauge',
    pages: [{ path: '/performance', label: 'Performance' }, { path: '/insights', label: 'Insights' }, { path: '/csat', label: 'Satisfaction' }, { path: '/digest', label: 'Weekly digest' }],
  },
  {
    key: 'tickets', label: 'Tickets', group: 'insights', path: '/tickets', icon: 'Ticket', gate: 'ticketing',
    pages: [{ path: '/tickets', label: 'Tickets' }, { path: '/tickets/reports', label: 'Reports' }],
  },

  { key: 'knowledge', label: 'Knowledge', group: 'data', path: '/knowledge', icon: 'BookOpen', pages: [{ path: '/knowledge', label: 'Knowledge' }] },
  {
    key: 'audiences', label: 'Audiences & lists', group: 'data', path: '/lists', icon: 'List', gate: 'native-crm',
    pages: [{ path: '/lists', label: 'Lists' }, { path: '/imports', label: 'Imports' }, { path: '/suppressions', label: 'Suppressions' }, { path: '/custom-fields', label: 'Custom fields' }],
  },
  {
    key: 'templates', label: 'Templates & brands', group: 'data', path: '/templates', icon: 'FileText',
    pages: [{ path: '/templates', label: 'Templates' }, { path: '/brands', label: 'Brands' }, { path: '/settings/brand-groups', label: 'Priority groups' }],
  },
]

/** Segment-aware prefix match: '/tickets' matches '/tickets/reports' but not '/ticketsX'. */
function underPath(rest: string, path: string): boolean {
  if (path === '') return rest === '' || rest === '/'
  return rest === path || rest.startsWith(path + '/') || rest.startsWith(path + '?')
}

/**
 * Strip the /dashboard/<ws> prefix. Returns null when the pathname isn't
 * under that workspace.
 */
export function workspaceRest(pathname: string, workspaceId: string): string | null {
  const base = `/dashboard/${workspaceId}`
  if (pathname === base) return ''
  if (pathname.startsWith(base + '/')) return pathname.slice(base.length)
  return null
}

/** The nav item a pathname belongs to (longest matching page wins). */
export function activeNavItem(pathname: string, workspaceId: string): NavItem | null {
  const rest = workspaceRest(pathname, workspaceId)
  if (rest === null) return null
  let best: { item: NavItem; len: number } | null = null
  for (const item of NAV_ITEMS) {
    for (const page of item.pages) {
      if (underPath(rest, page.path) && (!best || page.path.length > best.len)) {
        best = { item, len: page.path.length }
      }
    }
  }
  return best?.item ?? null
}

/**
 * Sibling-page tabs for the current pathname: the pages grouped under the
 * same nav item, filtered by the data gates the caller can satisfy. Empty
 * when the item has a single page (no strip needed).
 */
export function siblingsFor(
  pathname: string,
  workspaceId: string,
  gates: Partial<Record<NavGate, boolean>> = {},
): Array<NavPage & { href: string; active: boolean }> {
  const item = activeNavItem(pathname, workspaceId)
  if (!item || item.pages.length < 2) return []
  const rest = workspaceRest(pathname, workspaceId)!
  const pages = item.pages.filter(p => !p.gate || gates[p.gate])
  let activeLen = -1
  for (const p of pages) if (underPath(rest, p.path) && p.path.length > activeLen) activeLen = p.path.length
  return pages.map(p => ({
    ...p,
    href: `/dashboard/${workspaceId}${p.path}`,
    active: underPath(rest, p.path) && p.path.length === activeLen,
  }))
}

/** Settings shell nav (handoff §2 "Settings shell"). Paths are suffixes after /dashboard/<ws>. */
export interface SettingsNavItem {
  path: string
  label: string
  gate?: 'ticketing' | 'whitelabel'
  /** Sub-view selected by `?tab=`; items sharing a path are told apart by it. */
  tab?: string
}
export const SETTINGS_NAV: Array<{ group: string; items: SettingsNavItem[] }> = [
  {
    group: 'Workspace',
    items: [
      { path: '/settings', label: 'General' },
      { path: '/settings/members', label: 'Members' },
      { path: '/settings/notifications', label: 'Notifications' },
      { path: '/settings/domain', label: 'Custom domain', gate: 'whitelabel' },
    ],
  },
  {
    group: 'Connections',
    items: [
      { path: '/integrations', label: 'Integrations' },
      { path: '/settings/integrations', label: 'Shared channels' },
      { path: '/settings/integrations', label: 'Webhooks', tab: 'webhooks' },
      { path: '/settings/data-sources', label: 'Data sources' },
    ],
  },
  {
    group: 'Support desk',
    items: [
      { path: '/settings/ticketing', label: 'Ticketing' },
      { path: '/settings/sla', label: 'SLA policies' },
      { path: '/settings/live-chat', label: 'Live chat queue' },
      { path: '/settings/kiosk', label: 'Kiosk' },
    ],
  },
  { group: 'Billing', items: [{ path: '/settings/billing', label: 'Plan & usage' }] },
  {
    group: 'Security & compliance',
    items: [
      { path: '/audit-log', label: 'Audit log' },
      { path: '/consent', label: 'Consent' },
      { path: '/settings/api-access', label: 'API access' },
    ],
  },
]

/** Exact-or-descendant match, except '/settings' (General) which is exact-only. */
export function settingsItemActive(rest: string, path: string, tab?: string, currentTab?: string | null): boolean {
  if (path === '/settings') return rest === '/settings'
  if (!underPath(rest, path)) return false
  // Several items can share one page (Shared channels / Webhooks): a tabbed
  // item matches only its tab; the untabbed sibling matches every other state.
  if (tab) return currentTab === tab
  const sibling = SETTINGS_NAV.some(g => g.items.some(i => i.path === path && i.tab))
  return !sibling || !currentTab || !SETTINGS_NAV.some(g => g.items.some(i => i.path === path && i.tab === currentTab))
}
