import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'
import { STRIPE_PRICES } from '@/lib/plans'

/**
 * POST /api/billing/agents — Add extra agent slots
 * Body: { workspaceId, quantity: number }
 *
 * DELETE /api/billing/agents — Remove extra agent slots
 * Body: { workspaceId, quantity: number }
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId, quantity = 1 } = await req.json()
  if (!workspaceId || quantity < 1) {
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

  const newExtraCount = workspace.extraAgentCount + quantity

  // If they have a Stripe subscription and extra agent pricing is set up, update the subscription
  if (workspace.stripeSubscriptionId && STRIPE_PRICES.extraAgent) {
    const subscription = await stripe.subscriptions.retrieve(workspace.stripeSubscriptionId)
    const extraAgentItem = subscription.items.data.find(
      item => item.price.id === STRIPE_PRICES.extraAgent
    )

    if (extraAgentItem) {
      await stripe.subscriptionItems.update(extraAgentItem.id, {
        quantity: newExtraCount,
      })
    } else {
      await stripe.subscriptionItems.create({
        subscription: workspace.stripeSubscriptionId,
        price: STRIPE_PRICES.extraAgent,
        quantity: newExtraCount,
      })
    }
  }

  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      extraAgentCount: newExtraCount,
      agentLimit: workspace.agentLimit + quantity,
    },
  })

  return NextResponse.json({
    success: true,
    extraAgentCount: newExtraCount,
    totalAgentLimit: workspace.agentLimit + quantity,
  })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId, quantity = 1 } = await req.json()
  if (!workspaceId || quantity < 1) {
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

  const newExtraCount = Math.max(0, workspace.extraAgentCount - quantity)
  const agentsToRemove = workspace.extraAgentCount - newExtraCount

  // Update Stripe subscription
  if (workspace.stripeSubscriptionId && STRIPE_PRICES.extraAgent) {
    const subscription = await stripe.subscriptions.retrieve(workspace.stripeSubscriptionId)
    const extraAgentItem = subscription.items.data.find(
      item => item.price.id === STRIPE_PRICES.extraAgent
    )

    if (extraAgentItem) {
      if (newExtraCount === 0) {
        await stripe.subscriptionItems.del(extraAgentItem.id)
      } else {
        await stripe.subscriptionItems.update(extraAgentItem.id, {
          quantity: newExtraCount,
        })
      }
    }
  }

  await db.workspace.update({
    where: { id: workspaceId },
    data: {
      extraAgentCount: newExtraCount,
      agentLimit: Math.max(1, workspace.agentLimit - agentsToRemove),
    },
  })

  return NextResponse.json({
    success: true,
    extraAgentCount: newExtraCount,
    totalAgentLimit: Math.max(1, workspace.agentLimit - agentsToRemove),
  })
}
