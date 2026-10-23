import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { supportRoleFor } from '@/lib/support-session'
import { hostServesWorkspace } from '@/lib/whitelabel/guard'

/**
 * Role-gated version of requireWorkspaceAccess. Returns the session +
 * actual role if the caller is a member AND their role meets the minimum
 * required, otherwise returns a NextResponse (401/403) the caller can
 * return directly from a route handler.
 *
 * WorkspaceMember.role values: "owner" | "admin" | "member" | "viewer" |
 * "agent" (lib/permissions.ts). Rank: owner > admin > member > viewer =
 * agent. A required=admin check passes for both owner and admin; a
 * required=owner check passes only for owner; viewer and agent never
 * meet any requirement here. (They used to be read as 'member', which
 * let a read-only viewer or inbox-only agent through member-gated writes.)
 *
 * Keep in sync with the admin-side `roleHas` helper in lib/admin-auth.ts.
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member'

const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  agent: 0,
  member: 1,
  admin: 2,
  owner: 3,
}

export function workspaceRoleHas(role: string, required: WorkspaceRole): boolean {
  // Unknown role string in DB → no rank, so an ops mistake can't
  // accidentally grant access.
  return (ROLE_RANK[role] ?? -1) >= ROLE_RANK[required]
}


export async function requireWorkspaceRole(
  workspaceId: string,
  required: WorkspaceRole,
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!(await hostServesWorkspace(workspaceId))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const member = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: session.user.id, workspaceId },
    },
    select: { role: true },
  })
  // No membership row: a super admin in a support session for this
  // workspace gets the support role (see lib/support-session.ts).
  const rawRole = member?.role ?? supportRoleFor(session, workspaceId)
  if (!rawRole) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  if (!workspaceRoleHas(rawRole, required)) {
    return NextResponse.json({
      error: `Requires workspace role "${required}" or higher (you are "${rawRole}")`,
    }, { status: 403 })
  }
  // Every requirement is member or above, so a role that passed is one of these.
  const role = rawRole as WorkspaceRole

  return { session, role }
}
