import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'
import { supportRoleFor } from '@/lib/support-session'

/**
 * Checks that the currently authenticated user has access to the given workspace.
 * Returns the session + role if authorized, or a 401/403 NextResponse if not.
 *
 * Usage in API routes:
 * ```ts
 * const access = await requireWorkspaceAccess(workspaceId)
 * if (access instanceof NextResponse) return access
 * // access.session, access.role, access.workspace are now available
 * ```
 */
export async function requireWorkspaceAccess(workspaceId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const member = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: session.user.id,
        workspaceId,
      },
    },
    select: { role: true },
  })

  if (!member) {
    // A super admin in a support session for this workspace (see
    // lib/support-session.ts) — no membership row by design.
    const supportRole = supportRoleFor(session, workspaceId)
    if (supportRole) return { session, role: supportRole as string }
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  return { session, role: member.role }
}
