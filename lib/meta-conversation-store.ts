/**
 * Persistence layer for Messenger + Instagram conversations.
 *
 * Mirrors the role conversation-memory.ts plays for the agent loop, but
 * for the human-facing inbox: every inbound and outbound is recorded in
 * MetaConversation/MetaMessage so the unified inbox can render them
 * with sender names, channel pills, and a per-thread message history.
 *
 * Sender display names are resolved lazily — on the first inbound from
 * a given (page, sender) pair we hit Graph for `name` + `profile_pic`
 * and cache the result on the conversation row. Subsequent messages
 * skip the lookup. If Graph fails we degrade silently to the bare PSID.
 */

import { db } from './db'
import { getMessengerUserProfile, getInstagramUserProfile } from './meta-client'

export type MetaChannel = 'messenger' | 'instagram'

interface InboundParams {
  pageId: string
  pageName?: string
  senderId: string
  channel: MetaChannel
  workspaceId: string
  locationId: string
  /** Optional. When empty (e.g. CRM-marketplace forwarded the inbound)
   *  the Graph profile lookup is skipped — sender shows up with an
   *  unresolved fallback label until something else enriches it. */
  pageAccessToken?: string
  text: string
  mid?: string
  /** Raw event from Meta — stashed on the message for debugging. */
  metadata?: unknown
}

interface OutboundParams {
  pageId: string
  senderId: string
  channel: MetaChannel
  text: string
  /** When non-null, attribute the message to a human operator instead of the agent. */
  sentByUserId?: string
  metadata?: unknown
}

/**
 * Record an inbound message. Upserts the conversation (resolving the
 * sender's display name on first contact), then inserts a MetaMessage
 * row. Returns the conversation id so callers can pass it on to UI
 * code if needed.
 *
 * Returns null if the underlying tables don't exist yet — the manual
 * SQL migration may not have been applied. Callers should treat this
 * as "no UI visibility" rather than failing the agent path.
 */
export async function recordInboundMetaMessage(params: InboundParams): Promise<string | null> {
  const {
    pageId, pageName, senderId, channel, workspaceId, locationId,
    pageAccessToken, text, mid, metadata,
  } = params

  try {
    // Find or create the conversation. We can't use Prisma's upsert in
    // a single round-trip because the create branch needs a Graph
    // lookup that the update branch should skip.
    const existing = await db.metaConversation.findUnique({
      where: { pageId_senderId_channel: { pageId, senderId, channel } },
      select: { id: true, senderName: true, senderProfilePicUrl: true },
    })

    let conversationId: string
    if (existing) {
      conversationId = existing.id
      await db.metaConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: previewOf(text),
          lastMessageDirection: 'in',
          // Inbound message — clear any stale operator marker from a prior
          // outbound so the inbox doesn't keep attributing it to a human.
          lastMessageSentByUserId: null,
          unreadCount: { increment: 1 },
          // Refresh page name in case it changed in Meta.
          pageName: pageName ?? undefined,
        },
      })
    } else {
      const profile = pageAccessToken
        ? await resolveSenderProfile({ senderId, channel, pageAccessToken })
        : null
      const created = await db.metaConversation.create({
        data: {
          workspaceId,
          locationId,
          channel,
          pageId,
          pageName: pageName ?? null,
          senderId,
          senderName: profile?.name ?? null,
          senderProfilePicUrl: profile?.profilePicUrl ?? null,
          status: 'active',
          lastMessageAt: new Date(),
          lastMessagePreview: previewOf(text),
          lastMessageDirection: 'in',
          unreadCount: 1,
        },
        select: { id: true },
      })
      conversationId = created.id
    }

    // Insert the message. Dedupe by mid — Meta retries deliveries, and
    // a duplicate mid would otherwise produce double rows in the inbox.
    if (mid) {
      const dupe = await db.metaMessage.findUnique({ where: { mid }, select: { id: true } })
      if (dupe) return conversationId
    }

    await db.metaMessage.create({
      data: {
        conversationId,
        direction: 'in',
        text,
        mid: mid ?? null,
        metadata: (metadata as any) ?? undefined,
      },
    })

    return conversationId
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      // Tables haven't been migrated yet — the agent loop still works,
      // we just can't surface this conversation in the inbox.
      console.warn('[meta-conversations] tables missing — skipping persistence (run manual_meta_conversations.sql)')
      return null
    }
    console.error('[meta-conversations] inbound persist failed:', err?.message)
    return null
  }
}

export async function recordOutboundMetaMessage(params: OutboundParams): Promise<void> {
  const { pageId, senderId, channel, text, sentByUserId, metadata } = params
  try {
    const conv = await db.metaConversation.findUnique({
      where: { pageId_senderId_channel: { pageId, senderId, channel } },
      select: { id: true },
    })
    if (!conv) {
      // Outbound without an existing conversation row is a corner case
      // (operator initiating cold? agent replying to a message we
      // didn't persist?). Skip rather than silently inventing a
      // conversation with no inbound history.
      return
    }
    await db.$transaction([
      db.metaMessage.create({
        data: {
          conversationId: conv.id,
          direction: 'out',
          text,
          sentByUserId: sentByUserId ?? null,
          metadata: (metadata as any) ?? undefined,
        },
      }),
      db.metaConversation.update({
        where: { id: conv.id },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: previewOf(text),
          lastMessageDirection: 'out',
          // Denormalize the sender so the inbox list shows "AI" only for
          // agent replies. Null when the AI sent it (sentByUserId unset).
          lastMessageSentByUserId: sentByUserId ?? null,
        },
      }),
    ])
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      console.warn('[meta-conversations] tables missing — skipping outbound persistence')
      return
    }
    console.error('[meta-conversations] outbound persist failed:', err?.message)
  }
}

async function resolveSenderProfile(params: {
  senderId: string
  channel: MetaChannel
  pageAccessToken: string
}): Promise<{ name?: string; profilePicUrl?: string } | null> {
  const { senderId, channel, pageAccessToken } = params
  return channel === 'instagram'
    ? getInstagramUserProfile({ igsid: senderId, pageAccessToken })
    : getMessengerUserProfile({ psid: senderId, pageAccessToken })
}

function previewOf(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > 140 ? oneLine.slice(0, 139) + '…' : oneLine
}

export async function markMetaConversationRead(conversationId: string): Promise<void> {
  try {
    await db.metaConversation.update({
      where: { id: conversationId },
      data: { unreadCount: 0 },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) return
    console.error('[meta-conversations] mark-read failed:', err?.message)
  }
}
