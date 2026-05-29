/**
 * Portal-invite email dispatch via the shared branded wrapper.
 *
 * Required env:
 *   - RESEND_API_KEY
 *   - NOTIFICATION_FROM_EMAIL (or PORTAL_FROM_EMAIL override) — the
 *     portal-specific From wins so per-deployment whitelabel still works.
 */

import { escapeHtml, paragraphs, renderBrandedEmail } from '@/lib/email-render'
import { sendEmail } from '@/lib/email-send'

interface InvitePayload {
  to: string
  portalName: string
  inviteUrl: string
  /** Retained for back-compat; the branded wrapper sets its own accent. */
  primaryColor?: string | null
}

export async function sendPortalInviteEmail(p: InvitePayload): Promise<void> {
  const { html, text } = renderBrandedEmail({
    title: `You're invited to ${p.portalName}`,
    preheader: `Customer portal access for ${p.portalName}`,
    intro: `You've been invited to access the customer portal where you can review conversations, transcripts, and CSAT data for the brands assigned to you.`,
    bodyHtml: paragraphs([
      {
        html: `If the button doesn't open, paste this link into your browser:<br>
               <a href="${escapeHtml(p.inviteUrl)}" style="color:#fa4d2e;word-break:break-all;">${escapeHtml(p.inviteUrl)}</a>`,
      },
      `This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.`,
    ]),
    cta: { label: 'Accept invitation', url: p.inviteUrl },
  })

  await sendEmail({
    to: p.to,
    subject: `You're invited to ${p.portalName}`,
    html,
    text,
    from: process.env.PORTAL_FROM_EMAIL || undefined,
    context: 'PortalInvite',
  })
}
