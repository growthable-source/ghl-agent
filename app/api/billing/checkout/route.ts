import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { STRIPE_PRICES, PLAN_FEATURES, getPlanFeatures, type PlanId } from '@/lib/plans'
import { isInternalWorkspace } from '@/lib/internal-workspace'

/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout session for subscribing to a plan.
 *
 * Body: { workspaceId, plan: "starter"|"growth"|"scale", period: "monthly"|"annual" }
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { workspaceId, plan, period = 'monthly' } = body as {
    workspaceId: string
    plan: PlanId
    period: 'monthly' | 'annual'
  }

  if (!workspaceId || !plan || !['starter', 'growth', 'scale'].includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan or workspaceId' }, { status: 400 })
  }

  // Verify ownership
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

  // Internal workspaces skip Stripe entirely. We flip the workspace to
  // the requested plan in-place, clear any trial countdown, and return a
  // `url` that lands back on the billing page with a success flag so the
  // UI flow is indistinguishable from a real checkout.
  if (await isInternalWorkspace(workspaceId)) {
    const features = getPlanFeatures(plan)
    await db.workspace.update({
      where: { id: workspaceId },
      data: {
        plan,
        billingPeriod: period,
        agentLimit: features.agents,
        trialEndsAt: null,
      },
    })
    const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    return NextResponse.json({
      url: `${base}/dashboard/${workspaceId}/settings/billing?internal=1&plan=${plan}`,
      internal: true,
    })
  }

  // Get the Stripe price ID
  const priceConfig = STRIPE_PRICES[plan as keyof typeof STRIPE_PRICES]
  if (!priceConfig || typeof priceConfig === 'string') {
    return NextResponse.json({ error: 'Price not configured' }, { status: 500 })
  }
  const priceId = period === 'annual' ? priceConfig.annual : priceConfig.monthly
  if (!priceId) {
    return NextResponse.json({ error: 'Stripe price not configured for this plan/period' }, { status: 500 })
  }

  // Create or retrieve Stripe customer
  let customerId = workspace.stripeCustomerId
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: session.user.email || undefined,
      name: workspace.name,
      metadata: {
        workspaceId,
        userId: session.user.id,
      },
    })
    customerId = customer.id
    await db.workspace.update({
      where: { id: workspaceId },
      data: { stripeCustomerId: customerId },
    })
  }

  const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // Build line items: base plan + metered overage items
  const lineItems: any[] = [
    { price: priceId, quantity: 1 },
  ]

  // Add metered usage items if the plan supports them
  const features = PLAN_FEATURES[plan]
  if (features.messageOveragePrice > 0 && STRIPE_PRICES.messageOverage) {
    lineItems.push({ price: STRIPE_PRICES.messageOverage })
  }
  if (features.voiceOveragePrice > 0 && STRIPE_PRICES.voiceOverage) {
    lineItems.push({ price: STRIPE_PRICES.voiceOverage })
  }

  // Add extra agents if workspace already has some
  if (workspace.extraAgentCount > 0 && STRIPE_PRICES.extraAgent) {
    lineItems.push({
      price: STRIPE_PRICES.extraAgent,
      quantity: workspace.extraAgentCount,
    })
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: lineItems,
    success_url: `${baseUrl}/dashboard/${workspaceId}/settings?billing=success`,
    cancel_url: `${baseUrl}/dashboard/${workspaceId}/settings?billing=cancelled`,
    subscription_data: {
      metadata: { workspaceId, plan, period },
      trial_period_days: workspace.plan === 'trial' ? 7 : undefined,
    },
    metadata: { workspaceId, plan, period },
    allow_promotion_codes: true,
  })

  // If in trial, record which plan they selected
  if (workspace.plan === 'trial') {
    await db.workspace.update({
      where: { id: workspaceId },
      data: { planSelectedDuringTrial: plan },
    })
  }

  return NextResponse.json({ url: checkoutSession.url })
}
