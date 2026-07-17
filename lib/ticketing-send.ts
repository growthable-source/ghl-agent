/**
 * Shared Resend sender for the ticketing surfaces.
 *
 * One place to:
 *   - resolve the workspace's TicketingSettings.fromEmail / fromName
 *   - fall back to env defaults
 *   - call Resend
 *   - turn Resend's raw errors into something an operator can act on
 *
 * Used by:
 *   - app/api/workspaces/:ws/tickets/:id/messages (outbound reply on
 *     a ticket — appends signature, prefixes [#N] subject)
 *   - app/api/workspaces/:ws/settings/ticketing/test-email (pre-flight)
 */

import { db } from './db'

interface SendArgs {
  workspaceId: string
  to: string
  subject: string
  text: string
  /** Optional ticket number — when present we prefix subject with
   *  "[#N]" so replies thread back even before the inbound webhook
   *  is configured, and we set an X-Voxility-Ticket-Id header so the
   *  Resend Inbound parser can route on it. */
  ticketRef?: { id: string; number: number } | null
  /** Append the workspace's signature when true. False for test
   *  emails where the signature would be noise. */
  includeSignature?: boolean
}

export interface SendResult {
  ok: boolean
  /** Resend's id field — used as our outbound Message-ID for inbound
   *  threading. Only present when ok=true. */
  messageId: string | null
  /** Human-readable reason. Present on both success ("Sent.") and
   *  failure. Safe to display inline to the operator. */
  reason: string
  /** Raw Resend HTTP status when relevant — useful for debug logs. */
  status?: number
}

export async function sendTicketingEmail(p: SendArgs): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return {
      ok: false,
      messageId: null,
      reason: 'RESEND_API_KEY isn\'t set on this deployment. Ask an admin to add it.',
    }
  }

  const settings = await (db as any).ticketingSettings.findUnique({
    where: { workspaceId: p.workspaceId },
    select: { fromEmail: true, fromName: true, signature: true },
  }).catch(() => null)

  const fromAddr = settings?.fromEmail
    || process.env.NOTIFICATION_FROM_EMAIL_ADDRESS
    || process.env.NOTIFICATION_FROM_EMAIL
  const fromName = settings?.fromName || 'Support'
  if (!fromAddr) {
    return {
      ok: false,
      messageId: null,
      reason: 'No from-email configured. Set one in Settings → Ticketing → Reply from.',
    }
  }
  const from = fromAddr.includes('<') ? fromAddr : `${fromName} <${fromAddr}>`
  const subjectWithRef = p.ticketRef ? `[#${p.ticketRef.number}] ${p.subject}` : p.subject
  const bodyWithSig = p.includeSignature !== false && settings?.signature
    ? `${p.text}\n\n--\n${settings.signature}`
    : p.text

  let res: Response
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [p.to],
        subject: subjectWithRef,
        text: bodyWithSig,
        headers: p.ticketRef ? { 'X-Voxility-Ticket-Id': p.ticketRef.id } : undefined,
      }),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'network error'
    return { ok: false, messageId: null, reason: `Couldn't reach Resend: ${msg}` }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    return {
      ok: false,
      messageId: null,
      status: res.status,
      reason: humaniseResendError(res.status, errText, fromAddr),
    }
  }

  const data = (await res.json().catch(() => ({}))) as { id?: string }
  return { ok: true, messageId: data?.id ?? null, reason: 'Sent.', status: res.status }
}

/**
 * True when a failed send is worth retrying out-of-band: Resend was
 * rate-limiting (429), erroring (5xx), or unreachable (network throw —
 * no HTTP status at all). Config failures (missing key, no from-email,
 * unverified domain, bad addresses) fail identically on retry and need
 * an operator, not a cron.
 */
export function isTransientSendFailure(r: SendResult): boolean {
  if (r.ok) return false
  if (r.status === 429) return true
  if (typeof r.status === 'number' && r.status >= 500) return true
  return r.status === undefined && r.reason.startsWith("Couldn't reach Resend")
}

/**
 * Turn a Resend HTTP error body into a sentence an operator can act
 * on. Covers the failures we've actually seen + the most common docs
 * patterns. Falls through to a truncated raw snippet so even unknown
 * errors aren't fully hidden.
 *
 * Why this exists: the raw Resend error "API key not authorized to
 * send emails from growthable.io" is technically informative but
 * not actionable — operators don't know that "verify the domain at
 * resend.com/domains" is what they need to do. This function bridges
 * that gap.
 */
export function humaniseResendError(status: number, body: string, fromAddr?: string): string {
  const lower = body.toLowerCase()
  const domain = fromAddr ? fromAddr.split('@')[1] : null

  if (status === 403 && /not authorized|not verified|verify.*domain|domain.*verify/i.test(body)) {
    const dom = domain ? ` \`${domain}\`` : ''
    return `Your sender domain${dom} isn't verified in Resend. Verify it at https://resend.com/domains, then try again.`
  }
  if (status === 401 || /invalid api key|unauthor/i.test(lower)) {
    return 'Resend rejected the API key. Check that RESEND_API_KEY is set correctly on this deployment.'
  }
  if (status === 422 && /invalid.*from|from.*required/i.test(lower)) {
    return 'Resend rejected the From address. Use a real mailbox on a verified domain (e.g. support@yourcompany.com).'
  }
  if (status === 422 && /invalid.*to|to.*required/i.test(lower)) {
    return 'Resend rejected the recipient address. Double-check the email format.'
  }
  if (status === 429) {
    return 'Resend is rate-limiting this account right now. Wait a minute and try again.'
  }
  if (status >= 500) {
    return `Resend returned ${status} — usually transient. Check status.resend.com or retry in a minute.`
  }
  // Unknown failure mode — show a clipped raw snippet so the operator
  // has something to copy into a support ticket.
  return `Resend ${status}: ${body.slice(0, 200)}`
}
