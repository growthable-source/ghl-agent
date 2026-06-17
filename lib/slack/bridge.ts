import { db } from '@/lib/db'
import { getSlackConnection } from './connection'
import { enqueueSlackMessage } from './outbox'
import { broadcast } from '@/lib/widget-sse'
import { classifySlackReply } from './parse'
import { getUserInfo } from './client'

export type BridgeMode = 'off' | 'ai_with_handoff' | 'slack_only'

export function isBridged(mode: string | null | undefined): mode is 'ai_with_handoff' | 'slack_only' {
  return mode === 'ai_with_handoff' || mode === 'slack_only'
}

/** Resolve the channel to post into: per-agent override, else workspace default. */
function resolveChannel(
  agent: { slackChannelId?: string | null },
  conn: { defaultChannelId?: string | null },
): string | null {
  return agent.slackChannelId || conn.defaultChannelId || null
}

/**
 * Ensure a bridged conversation has a Slack thread, then mirror this
 * visitor message into it. Returns whether the AI should be suppressed
 * for this turn (true in slack_only). Safe no-op (suppressAi:false) when
 * the agent isn't bridged or the workspace has no Slack connection.
 */
export async function bridgeInboundVisitorMessage(args: {
  convo: {
    id: string
    workspaceId: string
    slackThreadTs: string | null
    visitorName?: string | null
    pageUrl?: string | null
  }
  agent: { slackBridgeMode: string; slackChannelId?: string | null }
  content: string
}): Promise<{ suppressAi: boolean }> {
  const mode = args.agent.slackBridgeMode
  if (!isBridged(mode)) return { suppressAi: false }

  const conn = await getSlackConnection(args.convo.workspaceId)
  if (!conn) return { suppressAi: false } // not connected → behave as off
  const channelId = resolveChannel(args.agent, conn)
  if (!channelId) return { suppressAi: false }

  if (!args.convo.slackThreadTs) {
    // Lazily create the parent. The outbox cron writes slackThreadTs back.
    const header = [
      `:speech_balloon: *New chat* — ${args.convo.visitorName || 'Visitor'}`,
      args.convo.pageUrl ? `<${args.convo.pageUrl}|page>` : null,
      '',
      args.content,
    ]
      .filter(Boolean)
      .join('\n')
    await enqueueSlackMessage({
      workspaceId: args.convo.workspaceId,
      conversationId: args.convo.id,
      channelId,
      threadTs: null,
      kind: 'parent',
      text: header,
    })
  } else {
    await enqueueSlackMessage({
      workspaceId: args.convo.workspaceId,
      conversationId: args.convo.id,
      channelId,
      threadTs: args.convo.slackThreadTs,
      kind: 'reply',
      text: `:bust_in_silhouette: ${args.content}`,
    })
  }

  return { suppressAi: mode === 'slack_only' }
}

/**
 * Mirror an AI reply into the conversation's Slack thread. No-op unless the
 * conversation already has a thread root (i.e. it's a bridged
 * ai_with_handoff conversation), so it's safe to call on every agent reply.
 */
export async function mirrorAgentMessage(conversationId: string, text: string) {
  const convo = await db.widgetConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      slackChannelId: true,
      slackThreadTs: true,
      widget: { select: { workspaceId: true } },
    },
  })
  if (!convo?.slackThreadTs || !convo.slackChannelId) return
  await enqueueSlackMessage({
    workspaceId: convo.widget.workspaceId,
    conversationId: convo.id,
    channelId: convo.slackChannelId,
    threadTs: convo.slackThreadTs,
    kind: 'reply',
    text: `:robot_face: ${text}`,
  })
}

/**
 * Apply a human's Slack thread reply to the widget conversation.
 * Public reply → WidgetMessage (role=agent) + handoff + SSE delivery.
 * Internal (`!`) reply → ConversationNote (visitor never sees it).
 */
export async function applySlackReply(args: {
  conversationId: string
  slackUserId: string
  botToken: string
  rawText: string
}) {
  const { visibility, text } = classifySlackReply(args.rawText)
  if (!text) return

  // Resolve operator: Slack email → workspace user (else Slack display name).
  let sentByUserId: string | null = null
  let displayName = 'Support'
  try {
    const info = await getUserInfo(args.botToken, args.slackUserId)
    displayName = info.displayName
    if (info.email) {
      const user = await db.user.findUnique({ where: { email: info.email }, select: { id: true } })
      sentByUserId = user?.id ?? null
    }
  } catch {
    /* fall back to the Slack display name */
  }

  if (visibility === 'internal') {
    await db.conversationNote.create({
      data: { conversationId: args.conversationId, authorUserId: sentByUserId, body: text },
    })
    return
  }

  const msg = await db.widgetMessage.create({
    data: { conversationId: args.conversationId, role: 'agent', content: text, kind: 'text', sentByUserId },
  })
  await db.widgetConversation.update({
    where: { id: args.conversationId },
    data: { status: 'handed_off', lastMessageAt: new Date() },
  })
  // Pause the AI's formal state machine too (mirror the inbox takeover path).
  await db.conversationStateRecord
    .updateMany({ where: { conversationId: args.conversationId }, data: { state: 'PAUSED' } })
    .catch(() => {})

  await broadcast(args.conversationId, {
    type: 'agent_message',
    id: msg.id,
    content: text,
    createdAt: msg.createdAt.toISOString(),
    fromHuman: true,
    operatorName: displayName,
  })
}
