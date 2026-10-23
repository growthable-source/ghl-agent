/**
 * What the Support Agent role (WorkspaceMember.role 'agent') may reach.
 *
 * The role has always been "inbox only" in the UI (DashboardSidebar hides
 * everything else), but almost every workspace API route checks plain
 * membership, so an agent could still call agent-edit, knowledge or
 * settings endpoints directly. White-label teams make that matter: the
 * customer's frontline staff are agents, and they must only answer chats
 * and work tickets.
 *
 * This is the single allowlist, applied centrally by
 * requireWorkspaceAccess / requireWorkspaceRole (API) and the workspace
 * layout (pages). Default deny: anything not listed is refused, so a new
 * route is safe until someone decides agents need it.
 *
 * Pure — no Prisma, no Next — so it is unit-tested and Edge-safe.
 */

/** Any method: the work itself (reply, assign, notes, tickets, presence). */
const AGENT_API_FAMILIES = new Set([
  'widget-conversations',
  'meta-conversations',
  'conversations', // takeover/resume of paused agent conversations
  'takeover',
  'tickets',
  'inbox',
  'me', // own presence + heartbeat
  'heartbeat',
  'notifications',
  'queue-feed',
])

/** Read-only context the inbox and ticket screens render (names, chips, flags). */
const AGENT_API_READ_FAMILIES = new Set([
  'members',
  'brands',
  'brand-groups',
  'settings',
  'live-chat-settings',
  'domain',
  'connection-health',
  'pause',
])

const READ_METHODS = new Set(['GET', 'HEAD'])

/** Dashboard sections (first segment after /dashboard/<workspaceId>/). */
const AGENT_PAGE_SECTIONS = new Set(['inbox', 'tickets'])

function segments(path: string): string[] {
  return path.split('?')[0].split('/').filter(Boolean)
}

/**
 * True when a Support Agent may call `method path`. `path` is the request
 * pathname. Workspace-scoped API routes are /api/workspaces/<id>/<family>/…;
 * anything outside that tree (e.g. /api/agents/*) is denied.
 */
export function agentMayCallApi(path: string, method: string): boolean {
  const s = segments(path)
  if (s[0] !== 'api' || s[1] !== 'workspaces' || !s[2]) return false
  const family = s[3]
  // The workspace record itself (name, logo) — read only.
  if (!family) return READ_METHODS.has(method.toUpperCase())
  if (AGENT_API_FAMILIES.has(family)) return true
  return AGENT_API_READ_FAMILIES.has(family) && READ_METHODS.has(method.toUpperCase())
}

/** True when a Support Agent may open this /dashboard/<workspaceId>/… page. */
export function agentMayOpenPage(path: string): boolean {
  const s = segments(path)
  if (s[0] !== 'dashboard' || !s[1]) return false
  return AGENT_PAGE_SECTIONS.has(s[2] ?? '')
}
