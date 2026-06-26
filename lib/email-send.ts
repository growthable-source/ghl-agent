/**
 * Shared Resend POST + error humanizer.
 *
 * Before this module every transactional sender (notifications.ts,
 * workspace-invite-email.ts, portal-email.ts, widget-recovery-email.ts,
 * digest-email.ts) hand-rolled its own fetch() to api.resend.com, its
 * own RESEND_API_KEY check, and threw a raw `Resend ${status}: ${body}`
 * on failure that meant nothing to the operator looking at server logs.
 *
 * This collapses that to one place. Callers pass { to, subject, html,
 * text } and get either a successful send or an Error with a
 * humanised message ("Your sender domain isn't verified in Resend.
 * Verify it at https://resend.com/domains, then try again.").
 *
 * humaniseResendError was lifted from lib/ticketing-send.ts — that
 * module remains the canonical source for ticketing's send path, but
 * the function is re-exported here so the rest of the platform can
 * benefit too.
 */

import { humaniseResendError } from '@/lib/ticketing-send'

export { humaniseResendError }

export interface SendEmailParams {
  to: string | string[]
  subject: string
  html: string
  text: string
  from?: string
  /** Identifier the sender uses in log messages — appears in skipped/error logs. */
  context?: string
}

/**
 * Sends a single email through Resend. Returns the Resend message id on
 * success. Throws on configuration problems (no API key) only when the
 * caller explicitly opts in via `throwOnMissingKey: true` — by default
 * the function logs and returns null, matching the pre-existing
 * dev-friendly behaviour where dev environments without a Resend key
 * still get to exercise the rest of the flow.
 */
export async function sendEmail(
  params: SendEmailParams,
  opts: { throwOnMissingKey?: boolean } = {},
): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY
  const from = params.from || process.env.NOTIFICATION_FROM_EMAIL || 'Xovera <notifications@xovera.io>'
  const ctx = params.context ? `[${params.context}] ` : ''

  if (!apiKey) {
    if (opts.throwOnMissingKey) {
      throw new Error('RESEND_API_KEY is not set on this deployment.')
    }
    console.warn(`${ctx}RESEND_API_KEY not set — email skipped:`, params.subject)
    return null
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(params.to) ? params.to : [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(humaniseResendError(res.status, body, from))
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string }
  return data?.id ?? null
}
