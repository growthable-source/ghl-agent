/**
 * Native CRM outbox drain. Picks up NativeMessage rows with status='queued'
 * and dispatches them through the right rail:
 *   - SMS / WhatsApp → Twilio (per-workspace creds via Integration table,
 *     falling back to env-level TWILIO_* for single-tenant deployments)
 *   - Email → Resend (RESEND_API_KEY + NOTIFICATION_FROM_EMAIL)
 *
 * On success the row flips to status='sent' and stores the rail's message
 * id (Twilio sid / Resend id). Twilio's status callback later flips it to
 * 'delivered' or 'failed'. Errors set status='failed' + providerError.
 *
 * Designed to run idempotently — it only touches queued rows, claims each
 * one with a status='sending' update before calling the rail, so concurrent
 * drain runs don't double-send.
 */

import { db } from './db'

interface SendResult {
  ok: boolean
  providerMessageId?: string
  error?: string
}

const SMS_LIKE = new Set(['sms', 'whatsapp'])

// Transient rail errors (rate limits, provider blips, network) get the
// message RE-QUEUED for the next minute-tick instead of permanently
// failed — previously one Twilio 429 silently killed a customer
// message forever. Permanent errors (bad number, auth, validation)
// still fail immediately. Bounded without a schema change: a message
// still failing transiently past this age gives up for good.
const RETRY_WINDOW_MS = 30 * 60 * 1000

function isTransientSendError(error: string | undefined): boolean {
  if (!error) return false
  return /\b(429|500|502|503|504)\b|rate limit|too many requests|timeout|timed out|ECONNRESET|ETIMEDOUT|fetch failed|socket hang|temporarily/i.test(
    error,
  )
}

export async function drainNativeOutbox(opts: { workspaceId?: string; limit?: number } = {}) {
  const where: any = { status: 'queued' }
  if (opts.workspaceId) where.workspaceId = opts.workspaceId

  const queued = await db.nativeMessage.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 50,
    include: { contact: true },
  })

  let sent = 0
  let failed = 0
  let requeued = 0

  for (const m of queued) {
    // Claim the row first so a parallel drain can't double-send. updateMany
    // with the queued precondition makes this atomic — if another worker
    // already claimed it, count comes back 0 and we move on.
    const claim = await db.nativeMessage.updateMany({
      where: { id: m.id, status: 'queued' },
      data: { status: 'sending' },
    })
    if (claim.count === 0) continue

    let result: SendResult
    try {
      if (SMS_LIKE.has(m.channel)) {
        result = await sendViaTwilio({ workspaceId: m.workspaceId, to: m.contact.phone, body: m.body })
      } else if (m.channel === 'email') {
        result = await sendViaResend({ workspaceId: m.workspaceId, to: m.contact.email, subject: m.subject, body: m.body })
      } else {
        result = { ok: false, error: `Unsupported channel: ${m.channel}` }
      }
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) }
    }

    if (result.ok) {
      await db.nativeMessage.update({
        where: { id: m.id },
        data: { status: 'sent', providerMessageId: result.providerMessageId ?? null },
      })
      sent++
    } else {
      const withinWindow = Date.now() - m.createdAt.getTime() < RETRY_WINDOW_MS
      if (isTransientSendError(result.error) && withinWindow) {
        // Back to the queue — the every-minute drain retries it.
        await db.nativeMessage.update({
          where: { id: m.id },
          data: { status: 'queued', providerError: `transient, will retry: ${result.error?.slice(0, 900)}` },
        })
        requeued++
        console.warn(`[native-outbox] transient failure on ${m.id} (${m.channel}) — requeued: ${result.error?.slice(0, 200)}`)
      } else {
        await db.nativeMessage.update({
          where: { id: m.id },
          data: { status: 'failed', providerError: result.error?.slice(0, 1000) ?? null },
        })
        failed++
        console.error(`[native-outbox] message ${m.id} (${m.channel}) permanently failed: ${result.error?.slice(0, 300)}`)
      }
    }
  }

  return { picked: queued.length, sent, failed, requeued }
}

// ─── Twilio ──────────────────────────────────────────────────────────────

async function sendViaTwilio(args: {
  workspaceId: string
  to: string | null
  body: string
}): Promise<SendResult> {
  if (!args.to) return { ok: false, error: 'Contact has no phone number' }

  const creds = await resolveTwilioCreds(args.workspaceId)
  if (!creds) return { ok: false, error: 'No Twilio credentials configured for workspace' }

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: args.to,
        From: creds.from,
        Body: args.body,
        // Status callback so deliveries/failures flip the row asynchronously.
        // Path matches app/api/twilio/status/route.ts.
        ...(creds.statusCallbackUrl ? { StatusCallback: creds.statusCallbackUrl } : {}),
      }),
    }
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 300)}` }
  }
  const json = await res.json().catch(() => ({} as any))
  return { ok: true, providerMessageId: json.sid }
}

async function resolveTwilioCreds(workspaceId: string): Promise<{
  accountSid: string; authToken: string; from: string; statusCallbackUrl?: string
} | null> {
  // Per-workspace Integration takes priority — one workspace might use a
  // shared platform Twilio number, another might bring their own.
  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  if (locations.length > 0) {
    const integ = await db.integration.findFirst({
      where: { locationId: { in: locations.map(l => l.id) }, type: 'twilio', isActive: true },
    })
    if (integ) {
      const c = integ.credentials as any
      const accountSid = c?.accountSid
      const authToken = c?.authToken
      const from = c?.fromNumber ?? c?.from
      if (accountSid && authToken && from) {
        return {
          accountSid, authToken, from,
          statusCallbackUrl: deriveStatusCallbackUrl(),
        }
      }
    }
  }

  // Fall back to env — single-tenant deployments often configure once.
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM_NUMBER
  if (accountSid && authToken && from) {
    return { accountSid, authToken, from, statusCallbackUrl: deriveStatusCallbackUrl() }
  }
  return null
}

function deriveStatusCallbackUrl(): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL
  if (!base) return undefined
  return `${base.replace(/\/$/, '')}/api/twilio/status`
}

// ─── Resend (email) ──────────────────────────────────────────────────────

async function sendViaResend(args: {
  workspaceId: string
  to: string | null
  subject: string | null
  body: string
}): Promise<SendResult> {
  if (!args.to) return { ok: false, error: 'Contact has no email address' }

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.NOTIFICATION_FROM_EMAIL
  if (!apiKey || !from) {
    return { ok: false, error: 'RESEND_API_KEY or NOTIFICATION_FROM_EMAIL not set' }
  }

  // Resend doesn't accept a plain-text-only payload reliably across all
  // accounts — wrap the body in minimal HTML so it lands in the inbox
  // looking sane regardless of the recipient's client.
  const html = `<div style="font-family:system-ui,-apple-system,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1c1917;white-space:pre-wrap">${escapeHtml(args.body)}</div>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: args.to,
      subject: args.subject || '(no subject)',
      text: args.body,
      html,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 300)}` }
  }
  const json = await res.json().catch(() => ({} as any))
  return { ok: true, providerMessageId: json.id }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
