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
 *   curl "https://app.xovera.io/api/admin/meta-webhook-diagnostic?secret=<CRON_SECRET>&pageId=1048992941631381"
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
  const appId = process.env.META_APP_ID
  if (!appSecret || !appId) {
    return NextResponse.json({ error: 'META_APP_SECRET / META_APP_ID not set in runtime' }, { status: 500 })
  }

  // Branch: ?check=meta returns Meta's view of the world — what
  // webhook subscriptions are registered at the App level, and what
  // apps the Page has subscribed. Independent of our pipeline; used to
  // diagnose "real DM doesn't arrive" when our pipeline test passed.
  if (req.nextUrl.searchParams.get('check') === 'meta') {
    return await checkMetaSide(req, appId, appSecret)
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

// ─── Meta-side check + auto-fix ──────────────────────────────────────────

const GRAPH = 'https://graph.facebook.com/v19.0'

async function checkMetaSide(req: NextRequest, appId: string, appSecret: string) {
  const fix = req.nextUrl.searchParams.get('fix') === 'true'
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN
  const expectedCallbackUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || 'https://app.xovera.io').replace(/\/+$/, '') + '/api/meta/webhook'
  const appToken = `${appId}|${appSecret}`
  const REQUIRED_FIELDS = ['messages', 'messaging_postbacks', 'message_reads', 'messaging_referrals']

  // 1. App-level subscriptions — what objects does this app receive
  //    webhooks for, and where are they delivered?
  const subsRes = await fetch(`${GRAPH}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`)
  const subsBody = await subsRes.json().catch(() => null) as { data?: Array<{ object: string; callback_url: string; fields: Array<{ name: string; version: string }>; active: boolean }> } | null
  const pageSub = subsBody?.data?.find(s => s.object === 'page') ?? null
  const igSub = subsBody?.data?.find(s => s.object === 'instagram') ?? null

  const findings: any = {
    appId,
    expectedCallbackUrl,
    appLevelSubscriptions: subsBody?.data ?? [],
    diagnosis: {} as Record<string, string>,
    actionsTaken: [] as string[],
  }

  // Per-page subscription check (uses the saved Integration's page token)
  const integrations = await db.integration.findMany({
    where: { type: 'meta', isActive: true },
    select: { id: true, locationId: true, credentials: true },
  })
  const perPage: any[] = []
  for (const integ of integrations) {
    const c = integ.credentials as any
    if (!c?.pageId || !c?.pageAccessToken) continue
    const r = await fetch(`${GRAPH}/${c.pageId}/subscribed_apps?access_token=${encodeURIComponent(c.pageAccessToken)}`)
    const body = await r.json().catch(() => null) as { data?: Array<{ id: string; name: string; subscribed_fields?: string[] }> } | null
    perPage.push({
      pageId: c.pageId,
      pageName: c.pageName,
      ourAppSubscribed: !!body?.data?.find(a => a.id === appId),
      subscribedApps: body?.data?.map(a => ({ id: a.id, name: a.name, fields: a.subscribed_fields })) ?? [],
    })
  }
  findings.perPageSubscriptions = perPage

  // ─── Diagnose ───────────────────────────────────────────────────
  if (!pageSub) {
    findings.diagnosis.pageObject = 'NOT subscribed at app level. Meta has no callback URL registered for the "page" object — DMs are dropped before they reach any URL.'
  } else if (pageSub.callback_url !== expectedCallbackUrl) {
    findings.diagnosis.pageObject = `Subscribed but pointed at WRONG URL: "${pageSub.callback_url}" (expected "${expectedCallbackUrl}").`
  } else if (!pageSub.active) {
    findings.diagnosis.pageObject = 'Subscribed and URL matches, but marked INACTIVE on Meta\'s side.'
  } else {
    const subscribedFields = pageSub.fields?.map(f => f.name) ?? []
    const missing = REQUIRED_FIELDS.filter(f => !subscribedFields.includes(f))
    if (missing.length > 0) {
      findings.diagnosis.pageObject = `Active and pointed at the right URL, but missing fields: ${missing.join(', ')}.`
    } else {
      findings.diagnosis.pageObject = '✅ App-level page subscription looks correct.'
    }
  }

  // ─── Auto-fix ───────────────────────────────────────────────────
  if (fix) {
    if (!verifyToken) {
      findings.actionsTaken.push('SKIPPED fix: META_WEBHOOK_VERIFY_TOKEN not set in runtime.')
    } else {
      // (Re)register the page subscription. Meta's API is idempotent
      // for this — same URL + token + fields just refreshes.
      const fixRes = await fetch(`${GRAPH}/${appId}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          object: 'page',
          callback_url: expectedCallbackUrl,
          fields: REQUIRED_FIELDS.join(','),
          verify_token: verifyToken,
          access_token: appToken,
        }).toString(),
      })
      const fixText = await fixRes.text()
      findings.actionsTaken.push(`POST /${appId}/subscriptions (page): ${fixRes.status} ${fixText.slice(0, 200)}`)

      // Re-subscribe each Page to the app — covers the per-page side.
      for (const integ of integrations) {
        const c = integ.credentials as any
        if (!c?.pageId || !c?.pageAccessToken) continue
        const r = await fetch(`${GRAPH}/${c.pageId}/subscribed_apps`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            subscribed_fields: REQUIRED_FIELDS.join(','),
            access_token: c.pageAccessToken,
          }).toString(),
        })
        findings.actionsTaken.push(`POST /${c.pageId}/subscribed_apps: ${r.status} ${(await r.text()).slice(0, 100)}`)
      }
    }
  }

  // ─── Wider Meta-side context ────────────────────────────────────
  // App roles: who can trigger webhooks in Dev mode.
  const rolesRes = await fetch(`${GRAPH}/${appId}/roles?access_token=${encodeURIComponent(appToken)}`)
  findings.appRoles = await rolesRes.json().catch(() => null)

  // Recent conversations on each Page from Meta's perspective. If a
  // DM was sent to the Page but no webhook fired on our side, this
  // shows the message exists and isolates the failure to delivery.
  const pageConversations: any[] = []
  for (const integ of integrations) {
    const c = integ.credentials as any
    if (!c?.pageId || !c?.pageAccessToken) continue
    const r = await fetch(`${GRAPH}/${c.pageId}/conversations?fields=updated_time,message_count,unread_count,participants,messages.limit(2){message,from,created_time}&limit=5&access_token=${encodeURIComponent(c.pageAccessToken)}`)
    const body = await r.json().catch(() => null)
    pageConversations.push({ pageId: c.pageId, pageName: c.pageName, conversations: body })
  }
  findings.pageConversations = pageConversations

  return NextResponse.json(findings)
}
