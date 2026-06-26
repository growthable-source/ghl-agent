/**
 * Magic link email for resuming a widget chat from a new device / cleared cookies.
 *
 * Sent by the /visitor identify endpoint whenever a fresh cookieId hands
 * us an email that already maps to a different WidgetVisitor on this
 * widget WITH a live conversation. The visitor clicks the link, the
 * recover endpoint re-points the original visitor row at the new
 * cookieId, and they pick up where they left off.
 *
 * Single-factor by design — email ownership is proved by the click.
 * Tokens expire in 30 minutes and are single-use.
 *
 * Uses the shared branded wrapper so the email picks up the Xovera
 * header, the standard CTA button shape, and the manage-notifications
 * footer link.
 */

import { escapeHtml, paragraphs, renderBrandedEmail } from '@/lib/email-render'
import { sendEmail } from '@/lib/email-send'

interface RecoveryPayload {
  to: string
  visitorName: string | null
  widgetName: string
  recoverUrl: string
  /** Retained for back-compat; the branded wrapper sets its own accent. */
  primaryColor?: string | null
}

export async function sendVisitorRecoveryEmail(p: RecoveryPayload): Promise<void> {
  const greeting = p.visitorName ? `Hi ${p.visitorName}, resume your chat` : 'Resume your chat'

  const { html, text } = renderBrandedEmail({
    title: greeting,
    preheader: `Pick up your conversation with ${p.widgetName} where you left off.`,
    intro: `It looks like you opened our chat from a new device or browser. Click below to pick up your conversation with ${p.widgetName} exactly where you left off.`,
    bodyHtml: paragraphs([
      {
        html: `If the button doesn't open, paste this link into your browser:<br>
               <a href="${escapeHtml(p.recoverUrl)}" style="color:#fa4d2e;word-break:break-all;">${escapeHtml(p.recoverUrl)}</a>`,
      },
      `This link expires in 30 minutes. If you didn't request it, you can safely ignore this email — nothing changes.`,
    ]),
    cta: { label: 'Resume chat', url: p.recoverUrl },
  })

  await sendEmail({
    to: p.to,
    subject: `Resume your chat with ${p.widgetName}`,
    html,
    text,
    context: 'WidgetRecovery',
  })
}
