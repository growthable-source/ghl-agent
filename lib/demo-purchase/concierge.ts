/**
 * Concierge fallback for the /try/[slug] purchase pipeline.
 *
 * Every post-payment failure in lib/demo-purchase/fulfill.ts routes here
 * instead of throwing: a paid buyer must NEVER see an error or get
 * stuck. `flagConcierge` (a) stamps a `concierge` flag onto the
 * prospect's `metadata.purchase` (re-read+merge, same as state.ts, so it
 * never clobbers prospecting-tool keys or a concurrent state write) and
 * (b) emails a human — Ryan by default — to finish the job by hand.
 *
 * Never throws. Both the DB write and the email send are individually
 * try/caught so a Resend outage can't turn "flag this for concierge"
 * into a second, worse failure that trips the webhook's error path.
 */
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { sendEmail } from '@/lib/email-send'
import { escapeHtml, paragraphs, renderBrandedEmail } from '@/lib/email-render'
import { mergePurchaseMetadata, type ConciergeFlag, type PurchasePeriod } from './state'

export const DEFAULT_CONCIERGE_EMAIL = 'ryan@growthable.io'

export async function flagConcierge(slug: string, stage: string, reason: string): Promise<void> {
  const flag: ConciergeFlag = { stage, reason, flaggedAt: new Date().toISOString() }

  try {
    const prospect = await db.demoProspect.findUnique({ where: { slug }, select: { id: true, metadata: true } })
    if (prospect) {
      const merged = mergePurchaseMetadata(prospect.metadata, { concierge: flag })
      await db.demoProspect.update({ where: { id: prospect.id }, data: { metadata: merged as Prisma.InputJsonValue } })
    } else {
      console.error(`[demo-purchase] flagConcierge: no prospect found for slug ${slug} (stage=${stage})`)
    }
  } catch (err) {
    console.error(`[demo-purchase] flagConcierge failed to persist flag for ${slug}:`, err)
  }

  try {
    const to = process.env.CONCIERGE_ALERT_EMAIL || DEFAULT_CONCIERGE_EMAIL
    const { html, text } = renderBrandedEmail({
      title: `Concierge needed — ${slug}`,
      severity: 'warning',
      preheader: `Stage: ${stage}`,
      bodyHtml: paragraphs([
        `A buyer paid for the demo bundle and automated provisioning hit a snag. They were NOT shown an error — please finish their setup by hand.`,
        { html: `<strong>Prospect slug:</strong> ${escapeHtml(slug)}` },
        { html: `<strong>Stage:</strong> ${escapeHtml(stage)}` },
        { html: `<strong>Reason:</strong> ${escapeHtml(reason)}` },
      ]),
    })
    await sendEmail({
      to,
      subject: `[Concierge] Demo purchase needs a hand — ${slug}`,
      html,
      text,
      context: 'DemoPurchaseConcierge',
    })
  } catch (err) {
    console.error(`[demo-purchase] concierge alert email failed for ${slug}:`, err)
  }
}

/**
 * Sent to the BUYER (not Ryan) when their payment cleared but
 * claimProspect() couldn't attach it to a workspace they own — e.g. a
 * free auth-claim beat the webhook to the punch and the two turned out
 * NOT to be the same person (see fulfillDemoBundle's account_ready →
 * claimed stage). A paying customer must never sit in silence; this is
 * the buyer-facing counterpart to flagConcierge's Ryan-facing alert.
 * Never throws — best-effort, same posture as flagConcierge.
 */
export async function notifyBuyerPendingConcierge(to: string, businessName: string): Promise<void> {
  try {
    const { html, text } = renderBrandedEmail({
      title: `We're completing your setup personally`,
      severity: 'info',
      preheader: `Your payment for ${businessName} is confirmed.`,
      bodyHtml: paragraphs([
        `Thanks for your purchase! Your payment for ${businessName} went through successfully.`,
        `You're paid — our team is completing your setup personally within 1 business day. You'll get an email as soon as it's ready.`,
        `You have not been, and will not be, charged again for this.`,
      ]),
    })
    await sendEmail({
      to,
      subject: `You're paid — we're completing your setup personally`,
      html,
      text,
      replyTo: process.env.CONCIERGE_ALERT_EMAIL || DEFAULT_CONCIERGE_EMAIL,
      context: 'DemoPurchaseBuyerPending',
    })
  } catch (err) {
    console.error(`[demo-purchase] buyer pending-concierge email failed for ${to}:`, err)
  }
}

export interface PurchaseSummary {
  contactEmail: string
  businessName: string
  period: PurchasePeriod
  stripeSubscriptionId: string | null
}

/**
 * INFO-only visibility ping to Ryan on EVERY completed demo-bundle
 * purchase — NOT a failure flag (no metadata write, unlike
 * flagConcierge). Exists because a stranger's email can legitimately end
 * up on a purchase (griefing / identity-planting: someone types a
 * business owner's email into their own checkout) — the magic-link email
 * to that address tells the recipient how to flag it, and this gives
 * Ryan a paper trail of every purchase to cross-check against complaints.
 * Never throws — best-effort, same posture as flagConcierge.
 */
export async function notifyPurchase(slug: string, summary: PurchaseSummary): Promise<void> {
  try {
    const to = process.env.CONCIERGE_ALERT_EMAIL || DEFAULT_CONCIERGE_EMAIL
    const { html, text } = renderBrandedEmail({
      title: `New demo-bundle purchase — ${summary.businessName}`,
      severity: 'info',
      preheader: `${summary.contactEmail} · ${summary.period}`,
      bodyHtml: paragraphs([
        { html: `<strong>Prospect slug:</strong> ${escapeHtml(slug)}` },
        { html: `<strong>Business:</strong> ${escapeHtml(summary.businessName)}` },
        { html: `<strong>Buyer email:</strong> ${escapeHtml(summary.contactEmail)}` },
        { html: `<strong>Billing period:</strong> ${escapeHtml(summary.period)}` },
        { html: `<strong>Stripe subscription:</strong> ${escapeHtml(summary.stripeSubscriptionId || 'unknown')}` },
      ]),
    })
    await sendEmail({
      to,
      subject: `[Purchase] ${summary.businessName} — ${summary.contactEmail}`,
      html,
      text,
      context: 'DemoPurchaseNotify',
    })
  } catch (err) {
    console.error(`[demo-purchase] purchase notify email failed for ${slug}:`, err)
  }
}
