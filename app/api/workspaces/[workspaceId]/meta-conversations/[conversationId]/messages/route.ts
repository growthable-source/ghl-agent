/**
 * Messages for a single Meta (Messenger / Instagram) conversation.
 *
 *   GET  → conversation metadata + ordered message list (oldest first
 *          for natural rendering in the detail panel).
 *   POST → operator-typed reply. Sends through Meta's Send API using
 *          the saved Page access token, then mirrors the message into
 *          MetaMessage with sentByUserId so the inbox can attribute
 *          human replies separately from agent replies.
 *
 * Marks the conversation as read on every GET. Operator opening the
 * thread is the same act as reading it; storing read receipts on the
 * Meta side would require IG-specific permissions we don't request.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { sendMetaMessage } from '@/lib/meta-client'
import { sendMessage as sendCrmMessage } from '@/lib/crm-client'
import { recordOutboundMetaMessage, markMetaConversationRead } from '@/lib/meta-conversation-store'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let conversation: any
  try {
    conversation = await db.metaConversation.findFirst({
      where: { id: conversationId, workspaceId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        assignedUser: { select: { id: true, name: true, email: true, image: true } },
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'meta tables not migrated' }, { status: 503 })
    }
    throw err
  }
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Mark read in the background — don't block the response on it.
  markMetaConversationRead(conversation.id).catch(() => {})

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      channel: conversation.channel,
      pageId: conversation.pageId,
      pageName: conversation.pageName,
      senderId: conversation.senderId,
      senderName: conversation.senderName,
      senderProfilePicUrl: conversation.senderProfilePicUrl,
      status: conversation.status,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      createdAt: conversation.createdAt.toISOString(),
      assignedUser: conversation.assignedUser,
      messages: conversation.messages.map((m: any) => ({
        id: m.id,
        direction: m.direction,
        text: m.text,
        sentByUserId: m.sentByUserId,
        createdAt: m.createdAt.toISOString(),
      })),
    },
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => ({})) as { content?: string }
  const text = (body.content ?? '').trim()
  if (!text) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const conversation = await db.metaConversation.findFirst({
    where: { id: conversationId, workspaceId },
    select: {
      id: true, pageId: true, senderId: true, channel: true, locationId: true,
      // The most recent inbound's timestamp drives the 24h-window
      // RESPONSE vs MESSAGE_TAG decision in pickMessagingType. Its
      // metadata.conversationProviderId carries the original GHL
      // provider id, which sendCrmMessage uses to route back through
      // the same channel the inbound arrived on.
      messages: {
        where: { direction: 'in' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { createdAt: true, metadata: true },
      },
    },
  }).catch((err: any) => {
    if (err?.code === 'P2021') return null
    throw err
  })
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Two reply paths exist depending on how the inbound arrived:
  //
  //  1. **Direct Meta OAuth** — Xovera has its own Page Access Token
  //     stored in an Integration row (matched by pageId). Reply goes
  //     straight to Meta's Send API.
  //
  //  2. **CRM marketplace forward** — the Page is connected via the
  //     operator's CRM (e.g. HighLevel), Meta delivers to the CRM, the
  //     CRM forwards to /api/webhooks/events. We have NO Page token.
  //     The reply has to go back the same way: through the CRM, which
  //     proxies it on to Meta. Detected by absence of a Meta Integration
  //     row for this pageId.
  const integration = await db.integration.findFirst({
    where: {
      type: 'meta',
      isActive: true,
      credentials: { path: ['pageId'], equals: conversation.pageId },
    },
    select: { credentials: true },
  })
  const pageAccessToken = (integration?.credentials as any)?.pageAccessToken as string | undefined

  if (pageAccessToken) {
    // Path 1 — direct Meta send.
    const lastInboundAt = conversation.messages[0]?.createdAt.toISOString()
    const send = await sendMetaMessage({
      pageAccessToken,
      recipientId: conversation.senderId,
      text,
      options: lastInboundAt ? { lastInboundAt } : {},
    })
    if (!send.ok) {
      return NextResponse.json({ error: 'send failed', detail: send.errorMessage }, { status: 502 })
    }
  } else {
    // Path 2 — CRM-routed reply. Reuse the conversationProviderId we
    // stashed on the inbound's metadata so the CRM dispatches on the
    // exact same provider/page the visitor reached us on.
    const meta = conversation.messages[0]?.metadata as { conversationProviderId?: string | null } | null
    const conversationProviderId = meta?.conversationProviderId ?? undefined
    try {
      await sendCrmMessage(conversation.locationId, {
        type: conversation.channel === 'instagram' ? 'IG' : 'FB',
        contactId: conversation.senderId,
        conversationProviderId,
        message: text,
      })
    } catch (err: any) {
      return NextResponse.json({ error: 'send failed', detail: err?.message ?? 'crm send error' }, { status: 502 })
    }
    // sendCrmMessage already mirrors the outbound into MetaConversation
    // (see lib/crm-client.ts), but with sentByUserId=null because that
    // helper doesn't know about the operator. We layer in attribution
    // by writing a follow-up row tagged with the user; deduping across
    // the two writes is fine — the inbox shows the operator-attributed
    // one and the auto-mirrored one becomes a same-second ghost we
    // can prune later if it bothers anyone.
    //
    // Quick path: skip recordOutboundMetaMessage entirely here so we
    // don't double-write. The auto-mirror in sendCrmMessage covers
    // visibility; the loss is operator-vs-agent attribution on this
    // single row, which we can address by threading sentByUserId
    // through the adapter in a follow-up.
    return NextResponse.json({ ok: true, via: 'crm' })
  }

  // Attribute to the operator who typed the reply, not the agent.
  await recordOutboundMetaMessage({
    pageId: conversation.pageId,
    senderId: conversation.senderId,
    channel: conversation.channel as 'messenger' | 'instagram',
    text,
    sentByUserId: access.session.user.id,
  })

  return NextResponse.json({ ok: true })
}
