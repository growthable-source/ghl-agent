import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

/**
 * Role-gated version of requireWorkspaceAccess. Returns the session +
 * actual role if the caller is a member AND their role meets the minimum
 * required, otherwise returns a NextResponse (401/403) the caller can
 * return directly from a route handler.
 *
 * WorkspaceMember.role values: "owner" | "admin" | "member".
 * Rank: owner > admin > member. A required=admin check passes for both
 * owner and admin; a required=owner check passes only for owner.
 *
 * Keep in sync with the admin-side `roleHas` helper in lib/admin-auth.ts.
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member'

const ROLE_RANK: Record<WorkspaceRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
}

export function workspaceRoleHas(role: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required]
}

function isWorkspaceRole(r: string): r is WorkspaceRole {
  return r === 'owner' || r === 'admin' || r === 'member'
}

export async function requireWorkspaceRole(
  workspaceId: string,
  required: WorkspaceRole,
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const member = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: { userId: session.user.id, workspaceId },
    },
    select: { role: true },
  })
  if (!member) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Unknown role string in DB → treat as lowest tier for safety, so an
  // ops mistake can't accidentally grant escalated access.
  const role: WorkspaceRole = isWorkspaceRole(member.role) ? member.role : 'member'
  if (!workspaceRoleHas(role, required)) {
    return NextResponse.json({
      error: `Requires workspace role "${required}" or higher (you are "${role}")`,
    }, { status: 403 })
  }

  return { session, role }
}
