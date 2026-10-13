import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { isGrowthablePlan } from '@/lib/partner/growthable-plans'
import { grantWorkspacePlan, XOVERA_PLAN } from '@/lib/partner/grant-plan'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST — super-admin "set plan" straight from the Workspaces tab.
 *
 * Body: { growthablePlan: GrowthablePlanId }
 *
 * For customers who bought a Growthable plan and signed up on Xovera
 * directly — no help-centre install row exists, so the install unlock
 * can't reach them. Grants the same thing the unlock does (see
 * grantWorkspacePlan) and records the Growthable plan in the audit log;
 * when the workspace does also have a PartnerInstall, its metadata.unlock
 * is updated too so the Help Center installs page stays in agreement.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { workspaceId } = await params
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true, plan: true } })
  if (!ws) return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!isGrowthablePlan(body.growthablePlan)) {
    return NextResponse.json({ error: 'growthablePlan must be one of the plans on growthable.io/pricing.' }, { status: 400 })
  }
  const growthablePlan = body.growthablePlan

  await grantWorkspacePlan(workspaceId)

  const install = await db.partnerInstall.findFirst({ where: { workspaceId }, select: { id: true, metadata: true } })
  if (install) {
    const meta = (install.metadata ?? {}) as Record<string, unknown>
    const prev = (meta.unlock ?? {}) as Record<string, unknown>
    await db.partnerInstall.update({
      where: { id: install.id },
      data: {
        metadata: {
          ...meta,
          unlock: { ...prev, growthablePlan, plan: XOVERA_PLAN, by: session.email, at: new Date().toISOString() },
        } as never,
      },
    })
  }

  logAdminActionAfter({
    admin: session,
    action: 'set_workspace_growthable_plan',
    target: workspaceId,
    meta: { workspaceName: ws.name, previousPlan: ws.plan, growthablePlan, plan: XOVERA_PLAN, installId: install?.id ?? null },
  })

  return NextResponse.json({ ok: true, growthablePlan, plan: XOVERA_PLAN })
}
