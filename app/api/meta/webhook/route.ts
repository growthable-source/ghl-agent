/**
 * Meta webhook receiver — Messenger + Instagram Direct.
 *
 * GET  ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<n>
 *      Meta's one-time verification handshake. We echo back the
 *      challenge if the verify_token matches META_WEBHOOK_VERIFY_TOKEN.
 *
 * POST {object: 'page' | 'instagram', entry: [...]}
 *      Live message delivery. Validate X-Hub-Signature-256 against the
 *      RAW body (using META_APP_SECRET), then for each entry dispatch
 *      to runChannelInbound. Each entry has its own pageId, so a
 *      single webhook can serve multiple connected Pages — we route
 *      via the Integration table.
 *
 * Always returns 200 to Meta after signature verification — Meta
 * retries on non-2xx and we don't want a transient routing failure
 * (no matching agent, etc.) to spam the queue.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyMetaSignature } from '@/lib/meta-webhook-verify'
import { findMetaIntegrationByEntryId } from '@/lib/meta-token-store'
import { sendMetaMessage } from '@/lib/meta-client'
import { runChannelInbound, finalizeChannelInbound } from '@/lib/channel-inbound'
import type { MessageChannelType } from '@/types'

// Meta delivers webhooks one at a time but each may contain several
// `entry` items. The agent loop runs Anthropic per entry so 300s is
// the right cap (Vercel Pro non-Enterprise max).
export const maxDuration = 300

// Disable Next's body parsing — verifyMetaSignature needs the raw bytes.
export const dynamic = 'force-dynamic'

interface MetaMessagingEvent {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: { mid: string; text?: string; is_echo?: boolean }
  postback?: { payload: string; title?: string }
  // ... other event types Meta may include (read receipts, delivery, etc.)
}

interface MetaWebhookEntry {
  id: string
  time: number
  messaging?: MetaMessagingEvent[]
}

interface MetaWebhookPayload {
  object: 'page' | 'instagram'
  entry?: MetaWebhookEntry[]
}

// ─── GET: subscription verification ──────────────────────────────────────

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN
  if (!expected) {
    console.error('[meta-webhook] META_WEBHOOK_VERIFY_TOKEN not set')
    return new NextResponse('verify token not configured', { status: 500 })
  }
  if (mode !== 'subscribe' || token !== expected) {
    return new NextResponse('forbidden', { status: 403 })
  }
  if (!challenge) return new NextResponse('missing challenge', { status: 400 })

  // Meta wants the challenge echoed verbatim as text/plain.
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

// ─── POST: live messages ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    console.error('[meta-webhook] META_APP_SECRET not set — rejecting all traffic')
    return new NextResponse('not configured', { status: 500 })
  }

  // Read the RAW body. Re-stringifying parsed JSON would change
  // whitespace and break HMAC verification.
  const rawBody = await req.text()
  const sigHeader = req.headers.get('x-hub-signature-256')
  const verify = verifyMetaSignature(rawBody, sigHeader, appSecret)
  if (!verify.ok) {
    console.warn(`[meta-webhook] signature rejected: ${verify.reason}`)
    return new NextResponse('signature mismatch', { status: 401 })
  }

  let payload: MetaWebhookPayload
  try {
    payload = JSON.parse(rawBody)
  } catch (err: any) {
    console.warn('[meta-webhook] invalid JSON body:', err?.message)
    // Still 200 — Meta retries non-2xx, and a malformed body won't get better.
    return new NextResponse('ok', { status: 200 })
  }

  // Map Meta's `object` field to our channel constants. Meta sends
  // 'page' for Messenger and 'instagram' for Instagram Direct.
  const channel: MessageChannelType =
    payload.object === 'instagram' ? 'IG'
    : payload.object === 'page' ? 'FB'
    : 'FB' // fall back to FB if Meta ever introduces another value

  for (const entry of payload.entry ?? []) {
    if (!entry.messaging || entry.messaging.length === 0) continue
    // Process each event sequentially — concurrency would race on
    // MessageLog rows for the same conversation and produce duplicate
    // outbounds.
    for (const event of entry.messaging) {
      try {
        await handleMessagingEvent(entry.id, event, channel)
      } catch (err: any) {
        console.error(`[meta-webhook] event handler threw for entry ${entry.id}:`, err?.message)
        // Swallow — Meta retries on 5xx and we'd rather the rest of the
        // batch process than fail the whole delivery.
      }
    }
  }

  return new NextResponse('ok', { status: 200 })
}

async function handleMessagingEvent(
  entryId: string,
  event: MetaMessagingEvent,
  channel: MessageChannelType,
): Promise<void> {
  // Echo events come back when WE send a message — Meta cc's the page's
  // own outbound to the webhook. Skip them; otherwise we'd loop.
  if (event.message?.is_echo) return

  const text = event.message?.text ?? event.postback?.payload
  if (!text || !text.trim()) return

  const integration = await findMetaIntegrationByEntryId(entryId)
  if (!integration) {
    console.warn(`[meta-webhook] no active Integration for entryId ${entryId} — drop`)
    return
  }

  const senderId = event.sender.id
  // Stable IDs scoped per (page, sender) so the same user texting two
  // different pages stays in two distinct conversations.
  const contactId = `meta-${entryId}-${senderId}`
  const conversationId = `meta-conv-${entryId}-${senderId}`

  const outcome = await runChannelInbound({
    locationId: integration.locationId,
    contactId,
    conversationId,
    inboundMessage: text,
    channel,
    enabledTools: ['send_sms'],
    channelInfoBlock: `## Channel Info\nThis is a ${channel === 'IG' ? 'direct Instagram message' : 'Facebook Messenger message'}. Page ID: ${entryId}, sender ID: ${senderId}. Replies are subject to Meta's 24-hour messaging window.`,
  })

  if (outcome.kind === 'skipped') return

  // Send the reply, if one was generated. The 24h-window logic in
  // pickMessagingType decides RESPONSE vs MESSAGE_TAG automatically.
  let sendSucceeded = true
  let sendErrorMessage: string | undefined
  if (outcome.result.reply) {
    const send = await sendMetaMessage({
      pageAccessToken: integration.credentials.pageAccessToken,
      recipientId: senderId,
      text: outcome.result.reply,
      options: {
        // event.timestamp is ms since epoch. We use it as the inbound's
        // canonical "last user activity" time for the 24h window check.
        lastInboundAt: new Date(event.timestamp).toISOString(),
      },
    })
    sendSucceeded = send.ok
    sendErrorMessage = send.errorMessage
    if (!send.ok) {
      console.error(`[meta-webhook] send failed for ${entryId}/${senderId}: ${send.errorMessage}`)
    }
  }

  await finalizeChannelInbound({
    outcome,
    contactId,
    locationId: integration.locationId,
    conversationId,
    inboundMessage: text,
    sendSucceeded,
    sendErrorMessage,
  })
}
