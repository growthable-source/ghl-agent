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
import { mergePurchaseMetadata, type ConciergeFlag } from './state'

const DEFAULT_CONCIERGE_EMAIL = 'ryan@growthable.io'

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
