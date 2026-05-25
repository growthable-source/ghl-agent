import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { canCreateWorkspace } from '@/lib/plans'
import { EMBED_SESSION_COOKIE } from '@/lib/embed-session'

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

  // Defense-in-depth: refuse workspace creation when the caller is in
  // marketplace-embed mode. The UI hides the "create workspace" entry
  // points in that context, but a direct fetch from the iframe would
  // otherwise still go through. Marketplace installs are 1-sub-account-
  // to-1-workspace by design — supplementing the bound workspace from
  // inside the iframe would create a workspace the user can never
  // navigate to (iframe lockdown redirects them back).
  const cookieStore = await cookies()
  if (cookieStore.get(EMBED_SESSION_COOKIE)) {
    return NextResponse.json(
      {
        error: 'Workspaces installed from a marketplace are locked to their CRM sub-account. To create another workspace, open Voxility in a regular browser tab.',
        code: 'EMBED_MODE_LOCKED',
      },
      { status: 403 },
    )
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
    // Direct signup — anyone arriving from a marketplace OAuth lands in
    // app/api/auth/callback/route.ts, which sets installSource there.
    // Native is the right default primary CRM because the next step
    // auto-provisions a native:<wsId> Location below.
    installSource: 'direct',
    primaryCrmProvider: 'native',
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
    // Billing columns may not exist yet — retry without them. Strip the
    // install attribution fields too, since the same un-migrated DB
    // class is what'd be missing those columns.
    const { installSource: _i, primaryCrmProvider: _p, ...legacyCreateData } = createData
    try {
      workspace = await db.workspace.create({ data: legacyCreateData })
    } catch {
      // Last-ditch: maybe billing columns exist but install columns
      // don't (older migration state). Try again with billing fields
      // but no install fields.
      workspace = await db.workspace.create({
        data: {
          ...legacyCreateData,
          plan: 'trial',
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      })
    }
  }

  // Auto-provision the native CRM as the default. Without this, every new
  // workspace lands with no Location row, the agent wizard has nothing
  // selected, and the user gets stuck at "Connect your CRM" with no way
  // forward unless they happen to know about the Integrations switch.
  // Native is reversible (Integrations → Switch to LeadConnector), so
  // making it the default removes the dead-end without locking anyone in.
  try {
    await db.location.create({
      data: {
        id: `native:${workspace.id}`,
        workspaceId: workspace.id,
        companyId: 'native',
        userId: 'native',
        userType: 'Location',
        scope: 'native',
        accessToken: 'native',
        refreshToken: 'native',
        refreshTokenId: 'native',
        expiresAt: new Date('2099-12-31T23:59:59.000Z'),
        crmProvider: 'native',
      },
    })
  } catch (err: any) {
    // NativeContact tables may not exist on the very first deploy of this
    // change (migration not yet applied). The workspace itself is fine —
    // the user can still switch CRMs from Integrations once tables exist.
    console.warn('[Workspaces] Native CRM auto-provision failed (non-fatal):', err?.message)
  }

  return NextResponse.json({ workspace, workspaceId: workspace.id }, { status: 201 })
}
