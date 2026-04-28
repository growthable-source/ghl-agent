import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generatePublicKey } from '@/lib/widget-auth'
import { canCreateWidget, widgetLimit, recommendPlanForLimit, PLAN_FEATURES } from '@/lib/plans'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const widgets = await db.chatWidget.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { conversations: true, visitors: true } },
      },
    })
    return NextResponse.json({ widgets })
  } catch {
    return NextResponse.json({ widgets: [], notMigrated: true })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const name = (body.name || '').trim() || 'New Widget'

  // Plan gating — uses the workspace owner's effective (best) plan, not
  // the local workspace.plan, so a user on Scale can spin up widgets in
  // any of their workspaces without each one being its own trial.
  try {
    const { getEffectivePlan } = await import('@/lib/effective-plan')
    const effective = await getEffectivePlan(workspaceId)
    const current = await db.chatWidget.count({ where: { workspaceId } })
    if (!canCreateWidget(effective.plan, current)) {
      const recommendedPlan = recommendPlanForLimit(effective.plan, 'WIDGET_LIMIT')
      const recommendedFeatures = recommendedPlan ? PLAN_FEATURES[recommendedPlan] : null
      const recommendedCap = recommendedPlan ? widgetLimit(recommendedPlan) : null
      return NextResponse.json({
        error: `Widget limit reached on the ${effective.plan} plan (${current}/${widgetLimit(effective.plan)}).`,
        code: 'WIDGET_LIMIT',
        currentPlan: effective.plan,
        currentCount: current,
        currentLimit: widgetLimit(effective.plan),
        recommendedPlan,
        recommendedPlanLabel: recommendedFeatures?.label ?? null,
        recommendedPlanPrice: recommendedFeatures?.monthlyPrice ?? null,
        recommendedPlanCapacity: recommendedCap,
        benefit: recommendedPlan === 'scale'
          ? 'Unlimited widgets'
          : recommendedCap === Infinity ? 'Unlimited widgets' : `${recommendedCap} widgets`,
      }, { status: 403 })
    }
  } catch {
    // Pre-migration — allow
  }

  const type = body.type === 'click_to_call' ? 'click_to_call' : 'chat'
  const baseData = {
    workspaceId,
    name,
    publicKey: generatePublicKey(),
    defaultAgentId: body.defaultAgentId || null,
    voiceEnabled: type === 'click_to_call',
  }

  try {
    const widget = await db.chatWidget.create({
      data: { ...baseData, type },
    })
    return NextResponse.json({ widget })
  } catch (err: any) {
    // Pending click-to-call migration: ChatWidget.type (and friends) don't
    // exist yet. Fall back to creating a chat-only widget without the new
    // fields so the UI can still ship widgets, but tell the operator what
    // needs to happen for click-to-call to work.
    const isMissingColumn = err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')
    if (isMissingColumn) {
      if (type === 'click_to_call') {
        return NextResponse.json({
          error: "Click-to-call needs a database migration first — run prisma/migrations-legacy/manual_widget_click_to_call.sql in Supabase, then try again.",
          code: 'MIGRATION_PENDING',
        }, { status: 503 })
      }
      // Plain chat widget: try again without the new columns
      try {
        const widget = await db.chatWidget.create({ data: baseData })
        return NextResponse.json({ widget })
      } catch (err2: any) {
        return NextResponse.json({ error: err2.message || 'Failed to create widget' }, { status: 500 })
      }
    }
    return NextResponse.json({ error: err.message || 'Failed to create widget' }, { status: 500 })
  }
}
