import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, roleHas, logAdminActionAfter } from '@/lib/admin-auth'
import { invalidateGuidelinesCache } from '@/lib/platform-learning'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Flip a workspace's platform-learnings opt-out. Admin-only; viewer-tier
 * admins cannot mutate. Used from the workspace drill-down page as a
 * HTML form POST, so we redirect back afterwards for server-render
 * freshness.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) {
    return NextResponse.redirect(new URL('/admin/login', req.url))
  }
  if (!roleHas(session.role, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const ws = await db.workspace.findUnique({
    where: { id },
    select: { id: true, disableGlobalLearnings: true },
  })
  if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const next = !ws.disableGlobalLearnings
  await db.workspace.update({
    where: { id },
    data: { disableGlobalLearnings: next },
  })

  // Toggling affects what buildSystemPrompt injects into every agent in
  // this workspace on the very next inbound — drop the cache entry so
  // the change is visible immediately rather than up to 2 minutes later.
  invalidateGuidelinesCache('workspace', id)

  logAdminActionAfter({
    admin: session,
    action: 'workspace_toggle_global_learnings',
    target: id,
    meta: { disableGlobalLearnings: next },
  })

  return NextResponse.redirect(new URL(`/admin/workspaces/${id}`, req.url))
}
