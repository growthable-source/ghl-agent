import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { STRIPE_PRICES, getPlanDefaults, type PlanId, PLAN_FEATURES } from '@/lib/plans'
import { isInternalWorkspace } from '@/lib/internal-workspace'

/**
 * POST /api/billing/change-plan
 * Upgrade or downgrade an existing subscription.
 *
 * Body: { workspaceId, plan: "starter"|"growth"|"scale", period?: "monthly"|"annual" }
 *
 * Upgrades: prorate immediately
 * Downgrades: schedule at end of current period
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId, plan, period } = await req.json() as {
    workspaceId: string
    plan: PlanId
    period?: 'monthly' | 'annual'
  }

  if (!workspaceId || !plan || !['starter', 'growth', 'scale'].includes(plan)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
  })
  if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
    return NextResponse.json({ error: 'Only owners and admins can manage billing' }, { status: 403 })
  }

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } })
  if (!workspace) {
    return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
  }

  // Internal workspaces flip plans instantly without touching Stripe —
  // no subscription required. Works whether they've ever gone through
  // checkout or not.
  if (await isInternalWorkspace(workspaceId)) {
    const defaults = getPlanDefaults(plan)
    const billingPeriod = period || workspace.billingPeriod || 'monthly'
    await db.workspace.update({
      where: { id: workspaceId },
      data: {
        plan,
        billingPeriod,
        agentLimit: defaults.agentLimit + (workspace.extraAgentCount ?? 0),
        messageLimit: defaults.messageLimit,
        voiceMinuteLimit: defaults.voiceMinuteLimit,
        trialEndsAt: null,
      },
    })
    return NextResponse.json({
      success: true, plan, isUpgrade: true, internal: true,
      message: `Plan set to ${plan} (internal — no billing).`,
    })
  }

  if (!workspace.stripeSubscriptionId) {
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 })
  }

  const currentPlanTier = ['starter', 'growth', 'scale'].indexOf(workspace.plan)
  const newPlanTier = ['starter', 'growth', 'scale'].indexOf(plan)
  const isUpgrade = newPlanTier > currentPlanTier

  const billingPeriod = period || workspace.billingPeriod || 'monthly'
  const priceConfig = STRIPE_PRICES[plan as keyof typeof STRIPE_PRICES]
  if (!priceConfig || typeof priceConfig === 'string') {
    return NextResponse.json({ error: 'Price not configured' }, { status: 500 })
  }
  const priceId = billingPeriod === 'annual' ? priceConfig.annual : priceConfig.monthly
  if (!priceId) {
    return NextResponse.json({ error: 'Stripe price not configured' }, { status: 500 })
  }

  // Retrieve current subscription
  const subscription = await stripe.subscriptions.retrieve(workspace.stripeSubscriptionId)
  const basePlanItem = subscription.items.data.find(item => {
    // Find the base plan item (not metered/extra-agent items)
    const p = item.price
    return p.recurring?.usage_type !== 'metered'
  })

  if (!basePlanItem) {
    return NextResponse.json({ error: 'Could not find base subscription item' }, { status: 500 })
  }

  if (isUpgrade) {
    // Upgrade: prorate immediately
    await stripe.subscriptions.update(workspace.stripeSubscriptionId, {
      items: [{ id: basePlanItem.id, price: priceId }],
      proration_behavior: 'create_prorations',
      metadata: { ...subscription.metadata, plan, period: billingPeriod },
    })
  } else {
    // Downgrade: schedule for end of current period
    await stripe.subscriptions.update(workspace.stripeSubscriptionId, {
      items: [{ id: basePlanItem.id, price: priceId }],
      proration_behavior: 'none',
      metadata: { ...subscription.metadata, plan, period: billingPeriod },
    })
  }

  // Update workspace with new plan details
  const defaults = getPlanDefaults(plan)
  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      plan,
      billingPeriod,
      stripePriceId: priceId,
      agentLimit: defaults.agentLimit + workspace.extraAgentCount,
      messageLimit: defaults.messageLimit,
      voiceMinuteLimit: defaults.voiceMinuteLimit,
    },
  })

  return NextResponse.json({
    success: true,
    plan,
    isUpgrade,
    message: isUpgrade
      ? 'Plan upgraded! Changes take effect immediately.'
      : 'Plan will be downgraded at the end of your current billing period.',
  })
}
