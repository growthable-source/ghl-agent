/**
 * Admin diagnostic for the direct Meta webhook path.
 *
 * Constructs a properly signed Messenger inbound (using the runtime's
 * META_APP_SECRET, which we can't pull locally because it's marked
 * Sensitive on Vercel), posts it to /api/meta/webhook, then reports:
 *
 *   - HTTP status of the webhook call
 *   - Whether a MetaConversation row was created within ~5s
 *   - Whether the Page has an Integration row to match against
 *
 * Lets us confirm OUR side of the pipeline works end-to-end without
 * waiting on Meta's actual delivery — useful when "I sent a real DM
 * and nothing showed up" could mean Meta isn't delivering OR our
 * handler is silently dropping.
 *
 * Auth: ?secret=<CRON_SECRET>. Same pattern the cron endpoints use.
 *
 * Usage:
 *   curl "https://app.voxility.ai/api/admin/meta-webhook-diagnostic?secret=<CRON_SECRET>&pageId=1048992941631381"
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'node:crypto'
import { db } from '@/lib/db'
import { findMetaIntegrationByEntryId } from '@/lib/meta-token-store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided = req.nextUrl.searchParams.get('secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  if (provided !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const appSecret = process.env.META_APP_SECRET
  if (!appSecret) {
    return NextResponse.json({ error: 'META_APP_SECRET not set in runtime' }, { status: 500 })
  }

  // Required: ?pageId=<page id of an Integration we want to test against>
  const pageId = req.nextUrl.searchParams.get('pageId')
  if (!pageId) {
    return NextResponse.json({
      error: 'pageId query param required',
      hint: 'Pass the Page ID from a saved Meta Integration row',
    }, { status: 400 })
  }

  // Confirm the page resolves to an active Integration. If not, the
  // webhook handler will drop the inbound silently — this diagnostic
  // surfaces the reason instead.
  const integration = await findMetaIntegrationByEntryId(pageId)
  if (!integration) {
    return NextResponse.json({
      ok: false,
      stage: 'integration-lookup',
      reason: 'No active Integration row matches this pageId. OAuth either never completed for this Page, or the integration was deactivated.',
      pageId,
    }, { status: 404 })
  }

  const senderId = req.nextUrl.searchParams.get('senderId') ?? `diag-${Math.random().toString(36).slice(2, 10)}`
  const text = req.nextUrl.searchParams.get('text') ?? `Diagnostic synthetic inbound at ${new Date().toISOString()}`
  const mid = `m_diag_${Date.now()}`

  const payload = {
    object: 'page',
    entry: [{
      id: pageId,
      time: Date.now(),
      messaging: [{
        sender: { id: senderId },
        recipient: { id: pageId },
        timestamp: Date.now(),
        message: { mid, text },
      }],
    }],
  }
  const rawBody = JSON.stringify(payload)
  const sig = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex')

  // POST to ourselves so the request goes through the same Next.js
  // routing layer Meta would hit, including signature verification
  // and the full handler. Constructing the absolute URL from the
  // request avoids hardcoding a domain.
  const selfUrl = new URL('/api/meta/webhook', req.nextUrl.origin)
  let webhookStatus: number
  let webhookBody: string
  try {
    const res = await fetch(selfUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig },
      body: rawBody,
    })
    webhookStatus = res.status
    webhookBody = (await res.text()).slice(0, 200)
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      stage: 'fetch-self',
      reason: err?.message ?? 'self-fetch failed',
    }, { status: 502 })
  }

  // Give the handler a few seconds to complete (it runs Anthropic +
  // sends a reply + persists). 5s should be enough for the inbox
  // persistence even if the agent send is still in flight.
  await new Promise(r => setTimeout(r, 5000))

  let row: any = null
  try {
    row = await db.metaConversation.findUnique({
      where: { pageId_senderId_channel: { pageId, senderId, channel: 'messenger' } },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
  } catch (err: any) {
    if (err?.code === 'P2021') {
      return NextResponse.json({
        ok: false,
        stage: 'db-query',
        reason: 'MetaConversation table does not exist — run manual_meta_conversations.sql',
      }, { status: 503 })
    }
    return NextResponse.json({ ok: false, stage: 'db-query', reason: err?.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: !!row,
    stage: row ? 'persisted' : 'webhook-200-no-row',
    integration: {
      id: integration.id,
      locationId: integration.locationId,
      isActive: integration.isActive,
      pageName: integration.credentials.pageName,
    },
    webhook: {
      status: webhookStatus,
      bodyPrefix: webhookBody,
    },
    metaConversation: row ? {
      id: row.id,
      senderId: row.senderId,
      senderName: row.senderName,
      lastMessagePreview: row.lastMessagePreview,
      unreadCount: row.unreadCount,
      messageCount: row.messages.length,
      messages: row.messages.map((m: any) => ({
        direction: m.direction,
        text: m.text?.slice(0, 80),
        mid: m.mid,
        createdAt: m.createdAt,
      })),
    } : null,
    note: row
      ? 'Direct Meta path is healthy end-to-end. If real DMs still don\'t arrive, the issue is on Meta\'s delivery side (App-level webhook subscription).'
      : 'Webhook returned 200 but no MetaConversation row was created within 5s. Check Vercel logs for [meta-webhook] / [meta-conversations] warnings.',
  })
}
