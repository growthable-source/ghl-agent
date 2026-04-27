import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { canCreateWorkspace } from '@/lib/plans'

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

  // Generate a URL-safe slug
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  const uniqueSuffix = Math.random().toString(36).slice(2, 8)
  const slug = `${baseSlug}-${uniqueSuffix}`

  // Build create data — handle case where billing columns may not exist yet
  const createData: any = {
    name,
    slug,
    icon,
    domain,
    members: {
      create: {
        userId: session.user.id,
        role: 'owner',
      },
    },
  }

  // Try to set billing fields (may fail if migration hasn't run)
  let workspace
  try {
    workspace = await db.workspace.create({
      data: {
        ...createData,
        plan: 'trial',
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    })
  } catch {
    // Billing columns may not exist yet — create without them
    workspace = await db.workspace.create({ data: createData })
  }

  return NextResponse.json({ workspace, workspaceId: workspace.id }, { status: 201 })
}
