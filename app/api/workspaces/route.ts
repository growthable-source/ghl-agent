import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { canCreateWorkspace } from '@/lib/plans'
import { provisionWorkspace } from '@/lib/provision-workspace'

/**
 * GET /api/workspaces — list workspaces for the current user
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Explicit select so Prisma doesn't pull every WorkspaceMember column by
  // default — pending migrations on this table would otherwise crash this
  // load (e.g. the digestOptIn / lastDigestSentAt columns).
  const memberships = await db.workspaceMember.findMany({
    where: { userId: session.user.id },
    select: {
      role: true,
      createdAt: true,
      workspace: {
        include: {
          _count: { select: { agents: true, locations: true, members: true } },
          locations: { select: { id: true, crmProvider: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const workspaces = memberships.map(m => ({
    ...m.workspace,
    role: m.role,
  }))

  return NextResponse.json({ workspaces })
}

/**
 * POST /api/workspaces — create a new workspace
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // (Earlier rev had a defensive 403 here when the embed cookie was
  // present, intended to block iframe-side workspace creation. Removed
  // because the embed cookie is SameSite=None and persists in regular
  // browser tabs too — locking out anyone who'd ever tested in the
  // iframe. The visual hiding of the create-workspace entry point
  // inside the iframe via useEmbedded() is enough.)

  const body = await req.json()
  const name = (body.name || '').trim()
  const icon = (body.icon || '🚀').trim()
  const domain = (body.domain || '').trim() || null

  if (!name) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  // ─── Feature gating: workspace limit ───
  try {
    const existingMemberships = await db.workspaceMember.findMany({
      where: { userId: session.user.id },
      select: { workspace: { select: { plan: true } } },
    })
    const plans = existingMemberships.map(m => m.workspace.plan)
    const bestPlan = (['scale', 'growth', 'starter', 'free', 'trial'] as const).find(p => plans.includes(p)) || 'trial'
    if (!canCreateWorkspace(bestPlan, existingMemberships.length)) {
      return NextResponse.json({
        error: 'Workspace limit reached. Upgrade your plan to create more workspaces.',
        code: 'WORKSPACE_LIMIT',
      }, { status: 403 })
    }
  } catch {
    // If gating query fails (migration pending), allow workspace creation
    console.warn('[Workspaces] Feature gating check failed — allowing creation')
  }

  // Shared with the /try demo claim and the partner provisioning API.
  // Also auto-provisions the native CRM Location — without it a new
  // workspace has nowhere to hang an agent (required FK) and the user is
  // stuck at "Connect your CRM" with no way forward.
  let workspace
  try {
    workspace = await provisionWorkspace({
      name,
      ownerUserId: session.user.id,
      icon,
      domain,
      // Direct signup — anyone arriving from a marketplace OAuth lands in
      // app/api/auth/callback/route.ts, which sets installSource there.
      installSource: 'direct',
    })
  } catch (err: any) {
    console.error('[workspaces] create failed:', err?.code, err?.message)
    return NextResponse.json({ error: err?.message ?? 'Failed to create workspace' }, { status: 500 })
  }

  return NextResponse.json({ workspace, workspaceId: workspace.id }, { status: 201 })
}
