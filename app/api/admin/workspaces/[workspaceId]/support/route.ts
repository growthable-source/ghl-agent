import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { startSupportSession } from '@/lib/support-session'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST — "Open workspace" from Admin → Workspaces → [workspace].
 *
 * Starts a support session scoped to this one workspace (see
 * lib/support-session.ts) and sends the admin into its dashboard. Posted
 * from a plain form, so it answers with a 303 to the dashboard. Admin
 * role or higher; the admin cookie is SameSite=Lax, so a cross-site form
 * can't trigger this.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { workspaceId } = await params
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } })
  if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  await startSupportSession(session, workspaceId)
  logAdminActionAfter({
    admin: session,
    action: 'support_session_start',
    target: workspaceId,
    meta: { workspaceName: ws.name },
  })

  return NextResponse.redirect(new URL(`/dashboard/${workspaceId}`, req.url), 303)
}
