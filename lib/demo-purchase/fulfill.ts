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
 * LeadConnector sub-account creation goes through
 * lib/leadconnector/agency-provisioning.ts. When LEADCONNECTOR_AGENCY_TOKEN
 * isn't set (or the API call fails), provisionLeadConnector() reports
 * not-ok and the pipeline routes that one stage through concierge — the
 * buyer still gets their workspace, billing, and (via completeDemoPurchase
 * below) magic-link sign-in; only the sub-account + phone-number steps
 * wait on a human.
 *
 * completeDemoPurchase() is the shared "finish the job" tail — it's
 * exported and reused by app/api/public/try/[slug]/purchase/number/route.ts
 * after a buyer picks (or skips) a phone number, since that happens well
 * after this webhook invocation has already returned (crm_ready and
 * number_purchasing are buyer-driven states this function never re-enters
 * on redelivery — see the early-return comment below). Splitting it out
 * keeps exactly one code path responsible for "send the magic link once
 * we've reached a terminal number_* state," whether the trigger was a
 * webhook-driven crm_failed short-circuit or a buyer's number selection.
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
import { flagConcierge, notifyBuyerPendingConcierge, notifyPurchase } from './concierge'
import { createMagicLinkToken, sendMagicLinkEmail } from './magic-link'
import {
  isLeadConnectorConfigured,
  createSubAccount,
  LeadConnectorError,
  LeadConnectorNotConfiguredError,
} from '@/lib/leadconnector/agency-provisioning'

async function provisionLeadConnector(input: {
  workspaceId: string
  businessName: string
  contactEmail: string | null
  websiteUrl: string | null
}): Promise<{ ok: true; locationId: string } | { ok: false; reason: string }> {
  if (!isLeadConnectorConfigured()) {
    return { ok: false, reason: 'LeadConnector agency provisioning is not configured (missing LEADCONNECTOR_AGENCY_TOKEN).' }
  }
  if (!input.contactEmail) {
    return { ok: false, reason: 'No contact email on the purchase — cannot create a LeadConnector sub-account.' }
  }
  try {
    const result = await createSubAccount({
      businessName: input.businessName,
      email: input.contactEmail,
      ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
    })
    return { ok: true, locationId: result.locationId }
  } catch (err) {
    if (err instanceof LeadConnectorNotConfiguredError) return { ok: false, reason: err.message }
    if (err instanceof LeadConnectorError) return { ok: false, reason: err.userMessage }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: message || 'Unknown error provisioning the LeadConnector sub-account.' }
  }
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

  // ── duplicate-payment guard ──────────────────────────────────────────
  // A second Stripe Checkout Session completing for the same prospect
  // AFTER the pipeline already reached `paid` (or beyond) means someone
  // paid twice — two open tabs, a retried checkout that raced the
  // checkout-session route's best-effort "expire the old session" call,
  // etc. Never silently absorb a second charge: cancel the orphan
  // subscription immediately and loop Ryan in with BOTH subscription ids
  // (+ the incoming customer id) so he can refund the duplicate by hand.
  // `checkout_started` is deliberately excluded — that's the normal
  // pre-paid state every fresh session starts in, including the very
  // first webhook delivery for THIS session before stripeSessionId has
  // been stamped below.
  if (purchase && purchase.state !== 'checkout_started' && session.id !== purchase.stripeSessionId) {
    const incomingSubscriptionId = stripeIdOf(session.subscription)
    const incomingCustomerId = stripeIdOf(session.customer)
    if (incomingSubscriptionId) {
      try {
        await stripe.subscriptions.cancel(incomingSubscriptionId)
      } catch (err) {
        console.error(
          `[demo-purchase] failed to cancel duplicate subscription ${incomingSubscriptionId} for ${slug}:`,
          err instanceof Error ? err.message : err,
        )
      }
    }
    await flagConcierge(
      slug,
      'duplicate_payment',
      `Second paid Stripe session (${session.id}) completed after purchase.state was already "${purchase.state}" ` +
        `(original session ${purchase.stripeSessionId ?? 'unknown'}). Cancelled duplicate subscription ` +
        `${incomingSubscriptionId ?? 'unknown'} (original subscription ${purchase.stripeSubscriptionId ?? 'unknown'}), ` +
        `duplicate customer ${incomingCustomerId ?? 'unknown'} — refund the duplicate charge by hand.`,
    )
    return
  }

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
    const claim = await claimProspect(slug, purchase.userId, { viaPurchase: true })
    let claimedWorkspaceId: string | null = claim.ok ? claim.workspaceId : null

    if (!claim.ok && claim.reason === 'claimed_by_other') {
      // A free auth-claim (app/try/[slug]/claim/page.tsx) beat this
      // webhook to the punch — but claim.ts's own purchase_in_progress
      // guard only blocks that path when the claimer's account email
      // does NOT match the checkout email, so if we're here the emails
      // genuinely didn't match at claim time (different login vs. a
      // manually-typed checkout email for the same real person, or a
      // guard race). Check the ALREADY-claimed workspace's owner email
      // against the buyer's checkout email one more time here: if it
      // matches, this is the same buyer under a different account and we
      // should attach the paid subscription to that workspace rather
      // than orphaning their money. If it doesn't, someone else's free
      // claim is genuinely sitting on this buyer's paid demo — concierge
      // AND tell the buyer directly so they never sit in silence after
      // paying.
      const claimedProspect = await db.demoProspect.findUnique({
        where: { slug },
        select: { claimedWorkspaceId: true },
      })
      const existingWorkspaceId = claimedProspect?.claimedWorkspaceId ?? null
      let ownerEmailMatches = false
      if (existingWorkspaceId && purchase.contactEmail) {
        const owners = await db.workspaceMember.findMany({
          where: { workspaceId: existingWorkspaceId, role: 'owner' },
          select: { user: { select: { email: true } } },
        })
        ownerEmailMatches = owners.some(
          o => o.user?.email && o.user.email.toLowerCase() === purchase!.contactEmail!.toLowerCase(),
        )
      }
      if (ownerEmailMatches && existingWorkspaceId) {
        claimedWorkspaceId = existingWorkspaceId
      } else {
        await flagConcierge(slug, 'claim', `claimProspect failed: ${claim.reason}`)
        if (purchase.contactEmail) {
          await notifyBuyerPendingConcierge(purchase.contactEmail, prospect.businessName)
        }
        return
      }
    } else if (!claim.ok) {
      await flagConcierge(slug, 'claim', `claimProspect failed: ${claim.reason}`)
      return
    }

    const result = await advancePurchaseState(prospect.id, 'account_ready', 'claimed', { workspaceId: claimedWorkspaceId! })
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

  // ── LeadConnector sub-account ────────────────────────────────────────
  if (purchase.state === 'crm_provisioning') {
    const lc = await provisionLeadConnector({
      workspaceId: purchase.workspaceId!,
      businessName: prospect.businessName,
      contactEmail: purchase.contactEmail ?? null,
      websiteUrl: prospect.websiteUrl ?? null,
    })
    if (lc.ok) {
      const result = await advancePurchaseState(prospect.id, 'crm_provisioning', 'crm_ready', { locationId: lc.locationId })
      purchase = result.purchase ?? purchase
    } else {
      const failed = await advancePurchaseState(prospect.id, 'crm_provisioning', 'crm_failed', {})
      purchase = failed.purchase ?? purchase
      await flagConcierge(slug, 'leadconnector', lc.reason)
    }
  }

  // crm_ready and number_purchasing are buyer-driven — the buyer hasn't
  // picked (or skipped) a phone number yet, and won't for as long as
  // seconds to minutes after this webhook invocation returns, so there is
  // nothing more for THIS invocation to do. completeDemoPurchase() below
  // (called from app/api/public/try/[slug]/purchase/number/route.ts) picks
  // up from crm_failed/number_* once the buyer's action — or the
  // crm_failed fast-path, which needs no buyer action — lands.
  await completeDemoPurchase(slug)
}

/**
 * Buyer-driven completion tail, split out of fulfillDemoBundle so it can
 * be called both from here (the crm_failed fast-path, which has no
 * number step to offer) and from
 * app/api/public/try/[slug]/purchase/number/route.ts once the buyer picks
 * or skips a phone number. Re-reads current state and resumes from
 * wherever it actually is — same philosophy as fulfillDemoBundle: no-ops
 * cleanly on a state it doesn't recognize as ready to complete.
 */
export async function completeDemoPurchase(slug: string): Promise<void> {
  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return

  let purchase = getPurchase(prospect.metadata)
  if (!purchase) return

  // crm_failed has no number step to offer — go straight to deferred.
  if (purchase.state === 'crm_failed') {
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
      // INFO-only visibility ping to Ryan on every completed purchase —
      // not a failure flag, just a paper trail (see notifyPurchase's doc
      // comment on why this runs unconditionally, not just on failure).
      await notifyPurchase(slug, {
        contactEmail: purchase.contactEmail,
        businessName: prospect.businessName,
        period: purchase.period,
        stripeSubscriptionId: purchase.stripeSubscriptionId ?? null,
      })
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
