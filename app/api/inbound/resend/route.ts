import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'

/**
 * Resend Inbound webhook — receives parsed inbound emails and routes
 * each one to its ticket.
 *
 * Routing strategy (in order):
 *   1. RFC 5322 In-Reply-To header → match TicketMessage.messageId
 *      from a prior outbound. Most reliable — email clients almost
 *      always set this when replying.
 *   2. Subject-prefix [#N] → parse the ticket number, look up by
 *      (workspaceId, ticketNumber). The workspaceId is resolved
 *      from the `to` address via TicketingSettings.fromEmail. We
 *      stamp this prefix on every outbound, so even very simple
 *      mail clients that don't thread will still land replies on
 *      the right ticket.
 *   3. Nothing matched → CREATE a new ticket. The recipient address
 *      tells us which workspace; the from-address becomes the
 *      contact. This is the cold-inbound flow.
 *
 * Reopen rule: if the resolved ticket is closed/resolved AND
 * TicketingSettings.autoReopenOnReply is true, bump it back to open.
 *
 * Signature: Resend uses Svix-style HMAC headers. We verify with
 * RESEND_WEBHOOK_SECRET. Mis-signed payloads return 401 without
 * touching the DB.
 */

export const maxDuration = 30

interface ResendInboundFrom {
  email: string
  name?: string | null
}
interface ResendInboundAddress {
  email: string
  name?: string | null
}
interface ResendInboundPayload {
  type?: string
  data?: {
    from?: ResendInboundFrom
    to?: ResendInboundAddress[]
    subject?: string
    text?: string
    html?: string
    headers?: Record<string, string | string[]>
    // Some Resend Inbound shapes nest these instead of via headers
    in_reply_to?: string
    message_id?: string
  }
}

export async function POST(req: NextRequest) {
  // ── Signature verification ──────────────────────────────────────────
  const secret = process.env.RESEND_WEBHOOK_SECRET
  const rawBody = await req.text()

  if (secret) {
    const svixId = req.headers.get('svix-id')
    const svixTimestamp = req.headers.get('svix-timestamp')
    const svixSignature = req.headers.get('svix-signature')
    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: 'missing_svix_headers' }, { status: 401 })
    }
    if (!verifySvix(secret, svixId, svixTimestamp, svixSignature, rawBody)) {
      return NextResponse.json({ error: 'bad_signature' }, { status: 401 })
    }
  }
  // When the secret is unset (local dev / pre-config) we accept the
  // payload. Set RESEND_WEBHOOK_SECRET in prod env to enforce.

  let payload: ResendInboundPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const data = payload.data ?? {}
  const fromEmail = (data.from?.email ?? '').trim().toLowerCase()
  const fromName = data.from?.name ?? null
  const subject = (data.subject ?? '').trim()
  const text = (data.text ?? '').trim()
  const html = data.html ?? null
  if (!fromEmail || !text) {
    return NextResponse.json({ skipped: 'missing_from_or_text' })
  }

  // Resend may pass headers as either a flat object or nested arrays;
  // tolerate both. The headers we care about are case-insensitive per
  // RFC 5322 but Resend tends to lowercase them.
  const headers = data.headers ?? {}
  const headerVal = (key: string): string | null => {
    const raw = headers[key] ?? headers[key.toLowerCase()] ?? headers[key.toUpperCase()]
    if (Array.isArray(raw)) return raw[0] ?? null
    return typeof raw === 'string' ? raw : null
  }
  const inReplyTo = data.in_reply_to ?? headerVal('In-Reply-To') ?? null
  const messageId = data.message_id ?? headerVal('Message-ID') ?? headerVal('Message-Id') ?? null

  // ── Routing ─────────────────────────────────────────────────────────
  let ticket = inReplyTo ? await findTicketByInReplyTo(inReplyTo) : null

  if (!ticket) {
    const num = parseSubjectTicketNumber(subject)
    const toAddrs = (data.to ?? []).map(t => t.email.trim().toLowerCase())
    if (num !== null && toAddrs.length > 0) {
      ticket = await findTicketBySubjectNumberAndRecipient(num, toAddrs)
    }
  }

  // If we still have no ticket but DO have a recipient that maps to
  // a workspace's inbound address, CREATE a fresh ticket.
  let createdNew = false
  if (!ticket) {
    const toAddrs = (data.to ?? []).map(t => t.email.trim().toLowerCase())
    if (toAddrs.length > 0) {
      ticket = await createTicketFromInbound({
        toAddrs,
        fromEmail,
        fromName,
        subject: subject || '(no subject)',
      })
      createdNew = !!ticket
    }
  }

  if (!ticket) {
    // Inbound for an address that doesn't belong to any workspace's
    // ticketing setup. Return 200 so Resend doesn't retry forever.
    return NextResponse.json({ skipped: 'no_matching_workspace' })
  }

  // ── Append the inbound message ──────────────────────────────────────
  const now = new Date()
  await db.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      direction: 'inbound',
      fromEmail,
      fromName,
      body: text.slice(0, 200_000),
      bodyHtml: html ? html.slice(0, 500_000) : null,
      messageId,
      inReplyTo,
      createdAt: now,
    },
  })

  // ── Bookkeeping + reopen-on-reply ───────────────────────────────────
  const settings = await (db as any).ticketingSettings.findUnique({
    where: { workspaceId: ticket.workspaceId },
    select: { autoReopenOnReply: true },
  }).catch(() => null)

  const wasTerminal = ticket.status === 'closed' || ticket.status === 'resolved'
  const shouldReopen = wasTerminal && (settings?.autoReopenOnReply ?? true)

  const update: Record<string, unknown> = {
    lastActivityAt: now,
    lastInboundAt: now,
  }
  if (shouldReopen) {
    update.status = 'open'
    update.reopenedAt = now
    update.closedAt = null
  }
  await db.ticket.update({ where: { id: ticket.id }, data: update })

  return NextResponse.json({
    ok: true,
    ticketId: ticket.id,
    ticketNumber: ticket.ticketNumber,
    createdNew,
    reopened: shouldReopen,
  })
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Verify the Svix-style HMAC signature Resend uses. The signature
 * header carries one or more `vN,base64sig` pairs space-separated;
 * we accept the message if any of them match.
 */
function verifySvix(secret: string, id: string, timestamp: string, sigHeader: string, body: string): boolean {
  // Svix shared secrets are stored as base64 with a "whsec_" prefix.
  const keyBase64 = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret
  let keyBytes: Buffer
  try {
    keyBytes = Buffer.from(keyBase64, 'base64')
  } catch {
    return false
  }
  const signedPayload = `${id}.${timestamp}.${body}`
  const expected = createHmac('sha256', keyBytes).update(signedPayload).digest('base64')
  const expectedBuf = Buffer.from(expected)
  for (const part of sigHeader.split(' ')) {
    const idx = part.indexOf(',')
    if (idx < 0) continue
    const sig = part.slice(idx + 1)
    try {
      const sigBuf = Buffer.from(sig)
      if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) return true
    } catch { /* keep trying other pairs */ }
  }
  return false
}

/** "[#1042] Subject text" → 1042. Returns null when no prefix. */
function parseSubjectTicketNumber(subject: string): number | null {
  const m = subject.match(/\[#(\d{1,9})\]/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

async function findTicketByInReplyTo(inReplyTo: string) {
  // Strip angle brackets — RFC 5322 wraps Message-IDs in <...> but
  // the value WE stored from Resend's `id` doesn't have them. Try both.
  const variants = [inReplyTo, inReplyTo.replace(/^<|>$/g, '')]
  for (const v of variants) {
    const msg = await db.ticketMessage.findFirst({
      where: { messageId: v },
      select: { ticket: { select: { id: true, workspaceId: true, ticketNumber: true, status: true } } },
    })
    if (msg?.ticket) return msg.ticket
  }
  return null
}

async function findTicketBySubjectNumberAndRecipient(num: number, toAddrs: string[]) {
  // Resolve workspace by matching `to` against TicketingSettings.fromEmail.
  const settings = await (db as any).ticketingSettings.findMany({
    where: { fromEmail: { in: toAddrs.map(a => a) } },
    select: { workspaceId: true },
  }).catch(() => [])
  if (settings.length === 0) return null
  const workspaceIds = settings.map((s: { workspaceId: string }) => s.workspaceId)
  return db.ticket.findFirst({
    where: { ticketNumber: num, workspaceId: { in: workspaceIds } },
    select: { id: true, workspaceId: true, ticketNumber: true, status: true },
  })
}

async function createTicketFromInbound(p: {
  toAddrs: string[]
  fromEmail: string
  fromName: string | null
  subject: string
}) {
  const settings = await (db as any).ticketingSettings.findMany({
    where: { fromEmail: { in: p.toAddrs }, enabled: true },
    select: { workspaceId: true },
  }).catch(() => [])
  if (settings.length === 0) return null
  const workspaceId = settings[0].workspaceId as string

  return db.$transaction(async (tx) => {
    const last = await tx.ticket.findFirst({
      where: { workspaceId },
      orderBy: { ticketNumber: 'desc' },
      select: { ticketNumber: true },
    })
    const created = await tx.ticket.create({
      data: {
        workspaceId,
        ticketNumber: (last?.ticketNumber ?? 0) + 1,
        contactEmail: p.fromEmail,
        contactName: p.fromName,
        subject: p.subject.slice(0, 255),
        priority: 'normal',
        status: 'open',
      },
      select: { id: true, workspaceId: true, ticketNumber: true, status: true },
    })
    return created
  })
}
