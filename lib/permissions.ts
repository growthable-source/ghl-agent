/**
 * Workspace role + permission matrix.
 *
 * Single source of truth for what each role can do. Endpoint handlers
 * call `can(role, 'permission')` instead of hard-coding role string
 * comparisons — that way adding a new role or shifting a capability
 * happens in one place.
 *
 * Roles (in increasing privilege order):
 *   - viewer   read-only — see inbox, contacts, conversations, but no
 *              replies, no agent edits, no settings
 *   - member   the operator default — handle conversations, edit
 *              agents/knowledge/templates, manage day-to-day work
 *   - admin    everything `member` does + manage other members
 *              (invite/remove/change role for anyone below owner),
 *              edit workspace settings, see billing
 *   - owner    everything `admin` does + delete workspace, transfer
 *              ownership, change billing plan
 *
 * Owners are not removable by anyone but themselves (or another
 * owner). At least one owner must always exist per workspace.
 */

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer'

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  member: 2,
  viewer: 1,
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

export const ROLE_DESCRIPTION: Record<WorkspaceRole, string> = {
  owner: 'Full access including billing, ownership transfer, and workspace deletion.',
  admin: 'Manage members, edit workspace settings, and everything members can do.',
  member: 'Handle conversations, edit agents and knowledge, run the day-to-day.',
  viewer: 'Read-only access. See conversations and contacts but cannot reply or change anything.',
}

/**
 * What a role can DO. Adding a new capability: add a key here, gate the
 * relevant endpoint(s) on `can(role, '<new-key>')`, decide which roles
 * get it. Don't reach for `role === 'admin'` comparisons elsewhere —
 * they drift.
 */
export type Permission =
  | 'workspace.delete'           // permanently destroy the workspace
  | 'workspace.billing'          // change plan, see invoices
  | 'workspace.settings'         // edit name, logo, domain, integrations
  | 'members.invite'             // invite new teammates
  | 'members.remove'             // remove an existing member
  | 'members.role.change'        // change another member's role
  | 'agents.edit'                // create / modify / delete agents
  | 'agents.run'                 // (future — read-only could opt out)
  | 'conversations.reply'        // post messages, take over, mark resolved
  | 'conversations.view'         // read-only inbox / transcripts
  | 'knowledge.edit'             // edit Knowledge collections, brands
  | 'queue.act'                  // resolve approvals, accept corrections

const MATRIX: Record<WorkspaceRole, Set<Permission>> = {
  owner: new Set<Permission>([
    'workspace.delete', 'workspace.billing', 'workspace.settings',
    'members.invite', 'members.remove', 'members.role.change',
    'agents.edit', 'agents.run',
    'conversations.reply', 'conversations.view',
    'knowledge.edit', 'queue.act',
  ]),
  admin: new Set<Permission>([
    'workspace.billing', 'workspace.settings',
    'members.invite', 'members.remove', 'members.role.change',
    'agents.edit', 'agents.run',
    'conversations.reply', 'conversations.view',
    'knowledge.edit', 'queue.act',
  ]),
  member: new Set<Permission>([
    'agents.edit', 'agents.run',
    'conversations.reply', 'conversations.view',
    'knowledge.edit', 'queue.act',
  ]),
  viewer: new Set<Permission>([
    'agents.run',
    'conversations.view',
  ]),
}

export function isValidRole(value: unknown): value is WorkspaceRole {
  return value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer'
}

/**
 * The roles a current actor with `role` is allowed to assign to
 * someone else. An admin can mint members and viewers but not other
 * admins or owners. Owners can mint anyone except an owner (transfer
 * is its own flow).
 */
export function assignableRoles(role: WorkspaceRole): WorkspaceRole[] {
  if (role === 'owner') return ['admin', 'member', 'viewer']
  if (role === 'admin') return ['member', 'viewer']
  return []
}

export function can(role: string | undefined | null, perm: Permission): boolean {
  if (!role || !isValidRole(role)) return false
  return MATRIX[role].has(perm)
}

/**
 * Whether `actor` can act on `target` (e.g. change their role or
 * remove them). Higher-rank actors can act on lower-rank targets.
 * Same-rank actors cannot — admins can't kick other admins; owners
 * are mutually untouchable.
 */
export function outranks(actor: string | null | undefined, target: string | null | undefined): boolean {
  if (!isValidRole(actor) || !isValidRole(target)) return false
  return ROLE_RANK[actor] > ROLE_RANK[target]
}
