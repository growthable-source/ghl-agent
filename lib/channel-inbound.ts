/**
 * Shared "an inbound just arrived from a native channel" pipeline.
 *
 * Twilio direct + Meta (Messenger + Instagram) hit this. The webhook
 * for each channel resolves the integration, then hands a small bundle
 * of identifiers + the raw text to runChannelInbound — which:
 *
 *   1. Creates a MessageLog row (PENDING) so we have a record even if
 *      nothing else completes.
 *   2. Hard-filters out locations with zero rule-bound agents (the
 *      "no agent answered everything" footgun).
 *   3. Picks the agent via findMatchingAgent.
 *   4. Skips paused conversations (returns SKIPPED status).
 *   5. Loads message history with timestamps so the agent's relative-
 *      age tags + "Conversation Resumed" block work on this channel.
 *   6. Builds the system prompt (knowledge block + channel-specific tail).
 *   7. Runs the agent.
 *   8. Hands back the result + log id + history. The CALLER does the
 *      channel-specific send (Twilio API, Meta Graph, etc.) and then
 *      calls finalizeChannelInbound() to persist the outbound, mark
 *      the log row, and bill the workspace.
 *
 * Splitting "run" from "finalize" lets each channel handle its own
 * send semantics (synchronous SMS reply vs Meta's 24h-window logic
 * + tag picking) without needing a callback shape that has to know
 * about every channel.
 */

import { db } from './db'
import { runAgent, type AgentResponse } from './ai-agent'
import { buildKnowledgeBlock } from './rag'
import { findMatchingAgent } from './routing'
import { getOrCreateConversationState, incrementMessageCount } from './conversation-state'
import { saveMessages, getMessageHistory } from './conversation-memory'
import { trackMessageUsage } from './usage'
import type { Message, MessageChannelType } from '@/types'

export interface ChannelInboundParams {
  /** Location the inbound is bound to (resolved from the integration). */
  locationId: string
  /** Stable per-contact identifier (e.g. "twilio-+15551234567", "meta-psid-1234"). */
  contactId: string
  /** Stable per-conversation identifier (per-contact-per-channel). */
  conversationId: string
  /** Raw user text — already cleaned of HTML / channel-specific framing. */
  inboundMessage: string
  /** What channel this came in on. Drives ChannelDeployment matching. */
  channel: MessageChannelType
  /** Tools the agent is allowed to use on this channel (e.g. ['send_sms']). */
  enabledTools: string[]
  /** Channel-specific tail appended to the system prompt — e.g. "[Caller phone: +15551234567]". */
  channelInfoBlock?: string
}

export type ChannelInboundOutcome =
  | { kind: 'skipped'; reason: string; logId?: string }
  | { kind: 'ran'; logId: string | null; agent: { id: string; workspaceId: string | null }; result: AgentResponse }

/**
 * Runs the inbound through filtering + agent. Returns an outcome the
 * caller pattern-matches on. Never throws — exceptions are converted
 * into { kind: 'skipped', reason }.
 */
export async function runChannelInbound(params: ChannelInboundParams): Promise<ChannelInboundOutcome> {
  const {
    locationId, contactId, conversationId, inboundMessage, channel,
    enabledTools, channelInfoBlock,
  } = params

  // Persist immediately so we have a record even if nothing else
  // completes (no matching agent, paused, errors).
  let logId: string | null = null
  try {
    const log = await db.messageLog.create({
      data: { locationId, contactId, conversationId, inboundMessage, status: 'PENDING' },
      select: { id: true },
    })
    logId = log.id
  } catch (err: any) {
    console.warn(`[${channel}-inbound] MessageLog create failed (continuing):`, err?.message)
  }

  // Hard pre-filter: refuse to respond unless at least one active agent
  // on this location has at least one routing rule. Same guard as
  // /api/webhooks/events. Belt-and-braces against silent replies.
  const agentsWithRules = await db.agent.count({
    where: { locationId, isActive: true, routingRules: { some: {} } },
  })
  if (agentsWithRules === 0) {
    const reason = 'No active agents with routing rules on this location'
    if (logId) await markLogSkipped(logId, reason)
    return { kind: 'skipped', reason, logId: logId ?? undefined }
  }

  const agent = await findMatchingAgent(locationId, contactId, inboundMessage, channel)
  if (!agent) {
    const reason = 'No agent matched the inbound'
    if (logId) await markLogSkipped(logId, reason)
    return { kind: 'skipped', reason, logId: logId ?? undefined }
  }
  if (!(agent as any).routingRules || (agent as any).routingRules.length === 0) {
    const reason = `Matched agent "${agent.name}" returned with zero routing rules`
    console.error(`[${channel}-inbound] ✗ ${reason}`)
    if (logId) await markLogSkipped(logId, reason)
    return { kind: 'skipped', reason, logId: logId ?? undefined }
  }

  // Tag the log row with the agent so admin queries can filter by agent.
  if (logId) {
    await db.messageLog.update({ where: { id: logId }, data: { agentId: agent.id } }).catch(() => {})
  }

  const state = await getOrCreateConversationState(agent.id, locationId, contactId, conversationId)
  if (state.state === 'PAUSED') {
    const reason = 'Conversation paused'
    if (logId) await markLogSkipped(logId, reason)
    return { kind: 'skipped', reason, logId: logId ?? undefined }
  }

  // Load history with timestamps so runAgent's relative-age tags +
  // gap block work for this channel (covered by lib/agent-heuristics
  // tests). Day-N replies see day-1's exchange up to the rolling cap.
  const dbHistory = await getMessageHistory(agent.id, contactId, 20)
  const messageHistory: Message[] = dbHistory.map(m => ({
    id: m.id,
    conversationId: m.conversationId,
    locationId: m.locationId,
    contactId: m.contactId,
    body: m.content,
    direction: m.role === 'user' ? 'inbound' as const : 'outbound' as const,
    createdAt: m.createdAt.toISOString(),
  }))

  let systemPrompt = agent.systemPrompt
  if ((agent as any).instructions) systemPrompt += `\n\n## Additional Instructions\n${(agent as any).instructions}`
  systemPrompt += buildKnowledgeBlock((agent as any).knowledgeEntries, inboundMessage)
  if (channelInfoBlock) systemPrompt += `\n\n${channelInfoBlock}`

  const result = await runAgent({
    agentId: agent.id,
    locationId,
    contactId,
    conversationId,
    channel,
    incomingMessage: inboundMessage,
    messageHistory,
    systemPrompt,
    enabledTools,
    sandbox: false,
  })

  return {
    kind: 'ran',
    logId,
    agent: { id: agent.id, workspaceId: (agent as any).workspaceId ?? null },
    result,
  }
}

export interface FinalizeParams {
  outcome: Extract<ChannelInboundOutcome, { kind: 'ran' }>
  contactId: string
  locationId: string
  conversationId: string
  inboundMessage: string
  /** Whether the channel's send actually succeeded. Failed sends don't get
   *  persisted as outbound (else the agent thinks the contact saw it). */
  sendSucceeded: boolean
  /** Surfaced into MessageLog when sendSucceeded=false. */
  sendErrorMessage?: string
}

/**
 * Persist outbound + bill + finalize the log row. Call this AFTER
 * the channel-specific send (or non-send if the agent produced no reply).
 */
export async function finalizeChannelInbound(p: FinalizeParams): Promise<void> {
  const { outcome, contactId, locationId, conversationId, inboundMessage, sendSucceeded, sendErrorMessage } = p
  const { agent, result, logId } = outcome

  // Persist inbound + outbound to ConversationMessage. The inbound is
  // logged unconditionally; the outbound only if sendSucceeded — a
  // failed-to-send outbound would mislead the agent on the next turn.
  try {
    const toSave: Array<{ role: string; content: string }> = [
      { role: 'user', content: inboundMessage },
    ]
    if (result.reply && sendSucceeded) {
      toSave.push({ role: 'assistant', content: result.reply })
    }
    await saveMessages(agent.id, locationId, contactId, conversationId, toSave)
  } catch (err: any) {
    console.warn('[channel-inbound] saveMessages failed (non-fatal):', err?.message)
  }

  await incrementMessageCount(agent.id, contactId).catch(() => {})

  // Meter usage on successful sends only.
  if (result.reply && sendSucceeded && agent.workspaceId) {
    trackMessageUsage(agent.workspaceId, agent.id).catch(err =>
      console.error('[channel-inbound] trackMessageUsage failed:', err?.message)
    )
  }

  if (logId) {
    if (sendSucceeded) {
      await db.messageLog.update({
        where: { id: logId },
        data: {
          status: 'SUCCESS',
          outboundReply: result.reply ?? null,
          actionsPerformed: result.actionsPerformed ?? [],
          tokensUsed: result.tokensUsed ?? 0,
        },
      }).catch(() => {})
    } else {
      await db.messageLog.update({
        where: { id: logId },
        data: {
          status: 'ERROR',
          outboundReply: result.reply ?? null,
          errorMessage: (sendErrorMessage ?? 'Channel send failed').slice(0, 500),
        },
      }).catch(() => {})
    }
  }
}

async function markLogSkipped(logId: string, reason: string): Promise<void> {
  await db.messageLog.update({
    where: { id: logId },
    data: { status: 'SKIPPED', errorMessage: reason },
  }).catch(() => {})
}
