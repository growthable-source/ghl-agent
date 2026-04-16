import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/db'
import { getPlanDefaults, type PlanId } from '@/lib/plans'
import { resetUsageCounters } from '@/lib/usage'

/**
 * POST /api/webhooks/stripe
 * Handles Stripe webhook events for subscription lifecycle.
 */
export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET || ''
    )
  } catch (err: any) {
    console.error(`[Stripe Webhook] Signature verification failed:`, err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  console.log(`[Stripe Webhook] Event: ${event.type}`)

  try {
    switch (event.type) {

      // ── Checkout completed — new subscription ───────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as any
        const { workspaceId, plan, period } = session.metadata || {}
        if (!workspaceId || !plan) break

        const subscriptionId = session.subscription as string
        const subscription = await stripe.subscriptions.retrieve(subscriptionId)
        const defaults = getPlanDefaults(plan as PlanId)

        await db.workspace.update({
          where: { id: workspaceId },
          data: {
            plan,
            billingPeriod: period || 'monthly',
            stripeSubscriptionId: subscriptionId,
            stripeCustomerId: session.customer as string,
            stripePriceId: subscription.items.data[0]?.price.id || null,
            stripeCurrentPeriodEnd: new Date((subscription as any).current_period_end * 1000),
            agentLimit: defaults.agentLimit,
            messageLimit: defaults.messageLimit,
            voiceMinuteLimit: defaults.voiceMinuteLimit,
            // Clear trial fields
            trialEndsAt: null,
            planSelectedDuringTrial: null,
            // Reset usage for new billing period
            messageUsage: 0,
            voiceMinuteUsage: 0,
          },
        })

        console.log(`[Stripe] Workspace ${workspaceId} subscribed to ${plan} (${period})`)
        break
      }

      // ── Subscription updated (plan change, renewal) ─────────────────
      case 'customer.subscription.updated': {
        const subscription = event.data.object as any
        const { workspaceId, plan, period } = subscription.metadata || {}
        if (!workspaceId) break

        const workspace = await db.workspace.findUnique({ where: { id: workspaceId } })
        if (!workspace) break

        const updateData: any = {
          stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
        }

        // If the plan changed via Stripe
        if (plan && plan !== workspace.plan) {
          const defaults = getPlanDefaults(plan as PlanId)
          updateData.plan = plan
          updateData.billingPeriod = period || workspace.billingPeriod
          updateData.agentLimit = defaults.agentLimit + workspace.extraAgentCount
          updateData.messageLimit = defaults.messageLimit
          updateData.voiceMinuteLimit = defaults.voiceMinuteLimit
          updateData.stripePriceId = subscription.items.data[0]?.price.id || workspace.stripePriceId
        }

        // Handle subscription status changes
        if (subscription.status === 'active' && subscription.cancel_at_period_end) {
          // Subscription is set to cancel — still active until period end
          console.log(`[Stripe] Workspace ${workspaceId} subscription set to cancel at period end`)
        }

        await db.workspace.update({ where: { id: workspaceId }, data: updateData })
        break
      }

      // ── Invoice paid — successful renewal, reset usage ──────────────
      case 'invoice.paid': {
        const invoice = event.data.object as any
        const subscriptionId = invoice.subscription as string
        if (!subscriptionId) break

        const workspace = await db.workspace.findFirst({
          where: { stripeSubscriptionId: subscriptionId },
        })
        if (!workspace) break

        // Only reset on renewal invoices (not the first invoice)
        if (invoice.billing_reason === 'subscription_cycle') {
          await resetUsageCounters(workspace.id)
          console.log(`[Stripe] Reset usage counters for workspace ${workspace.id} — new billing cycle`)
        }
        break
      }

      // ── Invoice payment failed ──────────────────────────────────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object as any
        const subscriptionId = invoice.subscription as string
        if (!subscriptionId) break

        const workspace = await db.workspace.findFirst({
          where: { stripeSubscriptionId: subscriptionId },
        })
        if (!workspace) break

        console.warn(`[Stripe] Payment failed for workspace ${workspace.id} — invoice ${invoice.id}`)
        // Could send email notification here or set a "payment_failed" flag
        break
      }

      // ── Subscription deleted (cancelled or expired) ─────────────────
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any
        const { workspaceId } = subscription.metadata || {}

        const workspace = workspaceId
          ? await db.workspace.findUnique({ where: { id: workspaceId } })
          : await db.workspace.findFirst({ where: { stripeSubscriptionId: subscription.id } })

        if (!workspace) break

        // Revert to trial-like restricted state
        await db.workspace.update({
          where: { id: workspace.id },
          data: {
            plan: 'trial',
            stripeSubscriptionId: null,
            stripePriceId: null,
            stripeCurrentPeriodEnd: null,
            agentLimit: 1,
            messageLimit: 100,
            voiceMinuteLimit: 0,
            extraAgentCount: 0,
          },
        })

        console.log(`[Stripe] Subscription deleted for workspace ${workspace.id} — reverted to restricted trial`)
        break
      }

      // ── Trial will end (3 days before) ──────────────────────────────
      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object as any
        const { workspaceId } = subscription.metadata || {}
        if (workspaceId) {
          console.log(`[Stripe] Trial ending soon for workspace ${workspaceId}`)
          // Could trigger email notification here
        }
        break
      }

      default:
        console.log(`[Stripe Webhook] Unhandled event: ${event.type}`)
    }
  } catch (err: any) {
    console.error(`[Stripe Webhook] Error processing ${event.type}:`, err.message)
  }

  return NextResponse.json({ received: true })
}
