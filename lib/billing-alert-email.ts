/**
 * Billing-alert emails — the two senders flagged as TODOs in
 * app/api/webhooks/stripe/route.ts:
 *
 *   - sendTrialEndingEmail:      customer.subscription.trial_will_end
 *   - sendPaymentFailedEmail:    invoice.payment_failed
 *
 * Both go to every Owner of the workspace (falls back to the
 * earliest-joined member when no explicit Owner exists — same
 * resolution lib/effective-plan.ts uses for plan walking).
 *
 * Both use the shared branded wrapper at warning/error severity so the
 * recipient sees the colour-coded top bar + badge without reading the
 * subject. CTA points at the workspace's billing settings page.
 *
 * Failures are swallowed and logged — a Stripe webhook handler must
 * always 200 back to Stripe regardless of side-effect outcomes.
 */

import { db } from '@/lib/db'
import { renderBrandedEmail, paragraphs } from '@/lib/email-render'
import { sendEmail } from '@/lib/email-send'

interface BillingAlertContext {
  workspaceId: string
  workspaceName: string
  /** Absolute URL to the billing page. */
  billingUrl: string
}

/**
 * Look up every email we should notify for this workspace's billing.
 * Returns owner emails first; falls back to any member with an email
 * if no Owner has been set. Each user only appears once.
 */
async function getBillingRecipients(workspaceId: string): Promise<string[]> {
  try {
    const owners = await db.workspaceMember.findMany({
      where: { workspaceId, role: 'owner' },
      select: { user: { select: { email: true } } },
    })
    const ownerEmails = owners.map(o => o.user?.email).filter((e): e is string => !!e)
    if (ownerEmails.length > 0) return Array.from(new Set(ownerEmails))

    // Fallback: earliest-joined member. Legacy workspaces don't always
    // have an explicit Owner row.
    const members = await db.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      take: 1,
      select: { user: { select: { email: true } } },
    })
    return members.map(m => m.user?.email).filter((e): e is string => !!e)
  } catch (err: any) {
    console.warn(`[BillingAlert] Recipient lookup failed for workspace ${workspaceId}:`, err?.message)
    return []
  }
}

/**
 * Trial-will-end email. Stripe fires the underlying event 3 days
 * before the trial converts to a paid subscription, so this is a
 * heads-up, not an emergency — warning severity, not error.
 */
export async function sendTrialEndingEmail(ctx: BillingAlertContext & {
  trialEndsAt: Date
}): Promise<void> {
  const recipients = await getBillingRecipients(ctx.workspaceId)
  if (recipients.length === 0) {
    console.warn(`[BillingAlert] No recipients for trial-ending alert on workspace ${ctx.workspaceId}`)
    return
  }

  const daysLeft = Math.max(
    1,
    Math.round((ctx.trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  )
  const dayWord = daysLeft === 1 ? 'day' : 'days'

  const { html, text } = renderBrandedEmail({
    title: `Your Voxility trial ends in ${daysLeft} ${dayWord}`,
    preheader: `Pick a plan to keep ${ctx.workspaceName} running without interruption.`,
    severity: 'warning',
    intro: `Heads-up — your trial for ${ctx.workspaceName} ends on ${ctx.trialEndsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. Pick a plan to keep your agents running, your conversations live, and your inbox available.`,
    bodyHtml: paragraphs([
      `If you don't pick a plan before then, agents stop responding to inbound messages and the workspace drops into restricted mode (you keep your data; you just can't run agents until you subscribe).`,
      `You can upgrade in one click from the billing page.`,
    ]),
    cta: { label: 'Pick a plan', url: ctx.billingUrl },
    manageNotificationsUrl: `${process.env.APP_URL || ''}/dashboard`,
  })

  for (const to of recipients) {
    try {
      await sendEmail({ to, subject: `Your Voxility trial ends in ${daysLeft} ${dayWord}`, html, text, context: 'TrialEnding' })
    } catch (err: any) {
      console.warn(`[BillingAlert] Trial-ending send to ${to} failed:`, err?.message)
    }
  }
}

/**
 * Payment-failed email. Sent immediately after the
 * invoice.payment_failed webhook fires. Stripe will retry the charge
 * automatically (usually three times over a week); this email gets the
 * customer to fix the card before the retries exhaust and the
 * subscription is cancelled. Error severity — the workspace IS at risk
 * of degraded service if not addressed.
 */
export async function sendPaymentFailedEmail(ctx: BillingAlertContext & {
  amountDue: number | null
  currency: string | null
  attemptCount: number | null
  hostedInvoiceUrl: string | null
}): Promise<void> {
  const recipients = await getBillingRecipients(ctx.workspaceId)
  if (recipients.length === 0) {
    console.warn(`[BillingAlert] No recipients for payment-failed alert on workspace ${ctx.workspaceId}`)
    return
  }

  // Format the amount when present. Stripe gives us cents (or the
  // currency's smallest unit, which is fine for USD/EUR/GBP). Skip on
  // unknown — the message still reads well without it.
  const amountLine = ctx.amountDue !== null && ctx.currency
    ? `$${(ctx.amountDue / 100).toFixed(2)} ${ctx.currency.toUpperCase()}`
    : null

  // Stripe's retry schedule: after 3 failed attempts the subscription
  // is typically cancelled. Tailor the urgency.
  const attempt = ctx.attemptCount ?? 1
  const urgency = attempt >= 3
    ? `This was attempt ${attempt} and the next failure may cancel your subscription.`
    : attempt > 1
      ? `This was attempt ${attempt} — we'll retry automatically, but updating your card now avoids any service interruption.`
      : `We'll automatically retry the charge, but updating your card now avoids any service interruption.`

  const { html, text } = renderBrandedEmail({
    title: `Payment failed for ${ctx.workspaceName}`,
    preheader: `Update your billing details to keep your agents running.`,
    severity: 'error',
    intro: amountLine
      ? `Your most recent ${amountLine} charge for ${ctx.workspaceName} didn't go through.`
      : `Your most recent charge for ${ctx.workspaceName} didn't go through.`,
    bodyHtml: paragraphs([
      urgency,
      `Common causes: the card on file expired, the bank declined the charge for fraud review, or the card has insufficient funds. Updating the card on file usually resolves all three.`,
    ]),
    cta: { label: 'Update billing', url: ctx.hostedInvoiceUrl || ctx.billingUrl },
    manageNotificationsUrl: `${process.env.APP_URL || ''}/dashboard`,
  })

  for (const to of recipients) {
    try {
      await sendEmail({ to, subject: `Payment failed for ${ctx.workspaceName}`, html, text, context: 'PaymentFailed' })
    } catch (err: any) {
      console.warn(`[BillingAlert] Payment-failed send to ${to} failed:`, err?.message)
    }
  }
}
