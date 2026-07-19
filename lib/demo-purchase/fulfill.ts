/**
 * Post-payment fulfillment pipeline for the /try/[slug] embedded-checkout
 * bundle. Invoked from the `checkout.session.completed` branch in
 * app/api/webhooks/stripe/route.ts once `metadata.intent === 'demo_bundle'`.
 *
 * Walks the lib/demo-purchase/state.ts state machine one stage at a time,
 * RE-READING the prospect's current `purchase.state` before each stage
 * and only running the stage whose precondition matches. This makes the
 * whole pipeline resumable rather than merely idempotent-per-CAS:
 *
 *   - A double-delivered webhook (Stripe retries, or a manual replay)
 *     re-enters here, sees `purchase.state` already past whatever stage
 *     it would have run, and no-ops that stage — so exactly one user,
 *     one workspace, and one magic-link email ever get created no matter
 *     how many times this function runs for the same session.
 *   - A crash or transient failure mid-pipeline leaves `purchase.state`
 *     at whatever stage last committed; the NEXT webhook delivery (or a
 *     future manual re-drive) picks up from there instead of restarting.
 *
 * Every stage failure calls flagConcierge() and returns — it never
 * throws past this function. The webhook handler's own try/catch is a
 * second safety net, but is not the primary error-handling path: we want
 * concierge alerts (with stage + reason) landing in Ryan's inbox, not a
 * generic "Stripe Webhook Error" log line.
 *
 * LeadConnector: Task 3 replaces `provisionLeadConnector` below with a
 * real adapter (lib/leadconnector/agency-provisioning.ts). Until then it
 * always reports not_configured, which routes every purchase through the
 * concierge path for that one stage — the buyer still gets their
 * workspace, billing, and magic-link sign-in; only the sub-account +
 * phone-number steps wait on a human.
 */
import Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { db } from '@/lib/db'
import { getPlanDefaults, type PlanId } from '@/lib/plans'
import { claimProspect } from '@/lib/demo-prospects/claim'
import {
  advancePurchaseState,
  getPurchase,
  type PurchaseMetadata,
  type PurchasePeriod,
  type PurchaseState,
} from './state'
import { flagConcierge } from './concierge'
import { createMagicLinkToken, sendMagicLinkEmail } from './magic-link'

/**
 * TODO(ryan / Task 3): replace with lib/leadconnector/agency-provisioning.ts
 * createSubAccount() once the agency API details + LEADCONNECTOR_* envs
 * land. Until then this always reports not_configured so the pipeline
 * degrades to the concierge path instead of blocking a paid buyer.
 */
async function provisionLeadConnector(input: {
  workspaceId: string
  businessName: string
}): Promise<{ ok: true; locationId: string } | { ok: false; reason: string }> {
  void input // signature kept stable for Task 3's real implementation
  return { ok: false, reason: 'LeadConnector agency provisioning is not configured yet (Task 3).' }
}

function stripeIdOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

const COMPLETION_SOURCE_STATES: PurchaseState[] = ['number_purchased', 'number_failed', 'number_deferred']

export async function fulfillDemoBundle(session: Stripe.Checkout.Session): Promise<void> {
  const meta = (session.metadata || {}) as Record<string, string>
  const slug = meta.prospectSlug
  if (!slug) {
    console.error('[demo-purchase] fulfillDemoBundle called without a prospectSlug in session metadata')
    return
  }

  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) {
    console.error(`[demo-purchase] fulfillment: no DemoProspect row for slug ${slug}`)
    await flagConcierge(slug, 'fulfillment', 'Stripe webhook fired but no matching demo prospect was found.')
    return
  }

  let purchase = getPurchase(prospect.metadata)
  const period: PurchasePeriod = purchase?.period === 'annual' || meta.period === 'annual' ? 'annual' : 'monthly'

  // ── paid ──────────────────────────────────────────────────────────
  if (!purchase || purchase.state === 'checkout_started') {
    const subscriptionId = stripeIdOf(session.subscription)
    const customerId = stripeIdOf(session.customer)
    const email = session.customer_details?.email || purchase?.contactEmail || null
    const result = await advancePurchaseState(prospect.id, purchase?.state ?? null, 'paid', {
      period,
      contactEmail: email,
      paidAt: new Date().toISOString(),
      stripeSessionId: session.id,
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
    })
    purchase = result.purchase
  }
  if (!purchase) {
    console.error(`[demo-purchase] fulfillment: could not establish a purchase record for ${slug}`)
    await flagConcierge(slug, 'paid', 'Webhook fired but no purchase.state could be read or initialized.')
    return
  }

  // Belt-and-braces reaper guard, layer 2: the moment a prospect is paid,
  // pull expiresAt entirely — same "reaper must never touch this" posture
  // claimProspect() already uses for claimed assets. checkout-session's
  // +14d extension (layer 1) covers the window before payment; this
  // covers everything from payment through claim. Idempotent — nulling an
  // already-null column is a cheap no-op on every re-entry.
  await db.demoProspect
    .updateMany({ where: { id: prospect.id, expiresAt: { not: null } }, data: { expiresAt: null } })
    .catch(err => console.error(`[demo-purchase] failed to clear expiresAt for ${slug}:`, err?.message))

  // ── account_ready: user upsert (existing Google user attaches, no dup) ──
  if (purchase.state === 'paid') {
    const email = purchase.contactEmail
    if (!email) {
      await flagConcierge(slug, 'account', 'No contact email on the purchase — cannot create a user.')
      return
    }
    const existingUser = await db.user.findUnique({ where: { email }, select: { id: true, emailVerified: true } })
    const user = await db.user.upsert({
      where: { email },
      // Fresh signup — passwordless is fine, checkout email ownership is
      // the proof (same trust level as the LeadConnector iframe handshake).
      create: { email, name: prospect.businessName, emailVerified: new Date() },
      // Existing user (e.g. already signed in via Google with this email)
      // — attach, don't touch their name; only backfill emailVerified if
      // it was somehow null so a later Google sign-in can auto-link
      // (lib/auth.ts allowDangerousEmailAccountLinking gates on this).
      update: existingUser?.emailVerified ? {} : { emailVerified: new Date() },
      select: { id: true },
    })
    const result = await advancePurchaseState(prospect.id, 'paid', 'account_ready', { userId: user.id })
    purchase = result.purchase ?? purchase
  }

  // ── claimed: re-parent the demo agent into a real workspace ─────────
  if (purchase.state === 'account_ready') {
    if (!purchase.userId) {
      await flagConcierge(slug, 'claim', 'account_ready but no userId was recorded — cannot claim.')
      return
    }
    const claim = await claimProspect(slug, purchase.userId)
    if (!claim.ok) {
      await flagConcierge(slug, 'claim', `claimProspect failed: ${claim.reason}`)
      return
    }
    const result = await advancePurchaseState(prospect.id, 'account_ready', 'claimed', { workspaceId: claim.workspaceId })
    purchase = result.purchase ?? purchase
  }

  // ── billing stamp (mirrors the checkout.session.completed branch in
  //    app/api/webhooks/stripe/route.ts) + subscription metadata backfill
  //    so the existing lifecycle handlers (renewals/cancellations/failed
  //    payments) find this workspace exactly like a normal purchase ─────
  if (purchase.state === 'claimed') {
    if (!purchase.workspaceId || !purchase.stripeSubscriptionId) {
      await flagConcierge(slug, 'billing', 'claimed but missing workspaceId/stripeSubscriptionId — cannot stamp billing.')
      return
    }
    const plan = (process.env.DEMO_BUNDLE_PLAN || 'growth') as PlanId
    try {
      const subscription = await stripe.subscriptions.retrieve(purchase.stripeSubscriptionId)
      const defaults = getPlanDefaults(plan)
      await db.workspace.update({
        where: { id: purchase.workspaceId },
        data: {
          plan,
          billingPeriod: purchase.period,
          stripeSubscriptionId: purchase.stripeSubscriptionId,
          stripeCustomerId: purchase.stripeCustomerId || undefined,
          stripePriceId: subscription.items.data[0]?.price.id || null,
          stripeCurrentPeriodEnd: new Date((subscription as unknown as { current_period_end: number }).current_period_end * 1000),
          agentLimit: defaults.agentLimit,
          messageLimit: defaults.messageLimit,
          voiceMinuteLimit: defaults.voiceMinuteLimit,
          trialEndsAt: null,
          planSelectedDuringTrial: null,
          messageUsage: 0,
          voiceMinuteUsage: 0,
        },
      })
      await stripe.subscriptions
        .update(purchase.stripeSubscriptionId, {
          metadata: { workspaceId: purchase.workspaceId, plan, period: purchase.period },
        })
        .catch(err => console.error(`[demo-purchase] subscription metadata backfill failed for ${slug}:`, err?.message))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[demo-purchase] billing stamp failed for ${slug}:`, message)
      await flagConcierge(slug, 'billing', message || 'unknown error stamping billing onto the workspace')
      return
    }
    const result = await advancePurchaseState(prospect.id, 'claimed', 'crm_provisioning', {})
    purchase = result.purchase ?? purchase
  }

  // ── LeadConnector sub-account (stubbed — Task 3 replaces this) ──────
  if (purchase.state === 'crm_provisioning') {
    const lc = await provisionLeadConnector({ workspaceId: purchase.workspaceId!, businessName: prospect.businessName })
    if (lc.ok) {
      const result = await advancePurchaseState(prospect.id, 'crm_provisioning', 'crm_ready', { locationId: lc.locationId })
      purchase = result.purchase ?? purchase
    } else {
      const failed = await advancePurchaseState(prospect.id, 'crm_provisioning', 'crm_failed', {})
      purchase = failed.purchase ?? purchase
      await flagConcierge(slug, 'leadconnector', lc.reason)
    }
  }

  // crm_ready is buyer-driven (Task 3's numbers/number routes advance it
  // to number_purchasing) — nothing more for the webhook to do here yet.
  if (purchase?.state === 'crm_ready') return
  if (purchase?.state === 'number_purchasing') return

  // crm_failed has no number step to offer — go straight to deferred.
  if (purchase?.state === 'crm_failed') {
    const result = await advancePurchaseState(prospect.id, 'crm_failed', 'number_deferred', {})
    purchase = result.purchase ?? purchase
  }

  // ── complete: magic-link sign-in email ───────────────────────────────
  if (purchase && COMPLETION_SOURCE_STATES.includes(purchase.state)) {
    if (!purchase.userId || !purchase.workspaceId) {
      await flagConcierge(slug, 'magic_link', 'Missing userId/workspaceId at the completion stage.')
      return
    }
    if (!purchase.contactEmail) {
      await flagConcierge(slug, 'magic_link', 'Missing contactEmail — cannot send the magic-link sign-in email.')
      return
    }
    const fromState = purchase.state
    try {
      const rawToken = await createMagicLinkToken(purchase.userId, purchase.workspaceId)
      const base = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://xovera.io').replace(/\/$/, '')
      const magicLinkUrl = `${base}/welcome/${rawToken}`
      await sendMagicLinkEmail({ to: purchase.contactEmail, businessName: prospect.businessName, magicLinkUrl })
      await advancePurchaseState(prospect.id, fromState, 'complete', { magicLinkSentAt: new Date().toISOString() })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[demo-purchase] magic-link send failed for ${slug}:`, message)
      await flagConcierge(slug, 'magic_link', message || 'unknown error sending the magic-link email')
      // Deliberately leave purchase.state as-is (still one of the
      // COMPLETION_SOURCE_STATES) so a future retry/resend can complete
      // this stage without re-running everything above it.
    }
  }
}

export type { PurchaseMetadata }
