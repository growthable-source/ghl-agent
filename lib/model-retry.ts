/**
 * Out-of-band recovery for inbounds that went unanswered because the LLM call
 * failed.
 *
 * Two halves:
 *   1. recordUnansweredSkip() — called by the inbound paths when runAgent
 *      returns a `skipped` (unanswered) result. For a TRANSIENT failure on a
 *      retry-capable path it marks the MessageLog ERROR + schedules a retry
 *      (modelRetryAt) WITHOUT paging. For a PERMANENT failure (model_rejected)
 *      or a path the cron can't replay (native Twilio/Meta sends), it pages a
 *      human immediately — the pre-Phase-2 behavior.
 *   2. processModelRetries() — the retry-model-failures cron. Replays due rows
 *      by rebuilding the EXACT live prompt (buildCrmInboundPrompt) and calling
 *      runAgent, which sends through the CRM adapter just like a live reply.
 *      It pages only when retries are exhausted.
 *
 * Safety invariants:
 *   - Scheduling a retry must never SILENTLY swallow the inbound: if the
 *     schedule write fails for any reason (e.g. the columns aren't migrated
 *     yet), we fall back to paging.
 *   - The cron never auto-sends for approval-gated agents, never replays a
 *     conversation a human has taken over (PAUSED), and never double-replies a
 *     conversation already answered since the failure.
 */

import { db } from './db'
import { runAgent } from './ai-agent'
import { buildCrmInboundPrompt } from './crm-inbound-prompt'
import { getMessageHistory, saveMessages, updateContactMemorySummary } from './conversation-memory'
import { getOrCreateConversationState, incrementMessageCount } from './conversation-state'
import { trackMessageUsage } from './usage'
import { describeUnansweredSkip } from './agent/unanswered-skip'
import { isUnansweredSkip, isRetryableSkip } from './agent/reply-skip'
import { notify } from './notifications'
import { fireWebhook } from './webhooks'
import type { Message } from '@/types'

/** Total automatic attempts before giving up and paging a human. */
const MAX_RETRY_ATTEMPTS = 4
/** First retry fires this long after the failure; doubles each attempt
 *  (3 → 6 → 12 → 24 min ≈ a 45-min recovery window for a provider blip). */
const INITIAL_DELAY_MS = 3 * 60_000

function nextRetryAt(attemptCount: number): Date {
  const delay = INITIAL_DELAY_MS * 2 ** attemptCount
  return new Date(Date.now() + delay)
}

interface RecordSkipArgs {
  logId: string | null
  agentId?: string | null
  agentName: string
  workspaceId: string | null
  /** Inbound channel — persisted so the cron sends the retry on it. */
  channel: string
  conversationProviderId?: string | null
  contactId: string
  inboundMessage: string
  skipped: string
  skipDetail?: string | null
  /** Whether this inbound path can be replayed by the cron. The CRM
   *  marketplace path = true; native Twilio/Meta sends = false (paged now). */
  retrySupported: boolean
}

/**
 * Record an unanswered-skip outcome: schedule an out-of-band retry for a
 * transient failure on a replayable path, otherwise page a human now.
 * Returns whether a retry was scheduled (the caller can skip its own page).
 */
export async function recordUnansweredSkip(args: RecordSkipArgs): Promise<{ scheduled: boolean }> {
  const { logId, agentId, agentName, workspaceId, channel, conversationProviderId,
    contactId, inboundMessage, skipped, skipDetail, retrySupported } = args

  const notice = describeUnansweredSkip({ agentName, inboundMessage, skipped, skipDetail })
  const wantRetry = retrySupported && isRetryableSkip(skipped)
  const errorMessage = notice.errorMessage.slice(0, 500)

  let scheduled = false
  if (logId) {
    if (wantRetry) {
      try {
        await db.messageLog.update({
          where: { id: logId },
          data: {
            status: 'ERROR',
            outboundReply: null,
            errorMessage,
            channel,
            conversationProviderId: conversationProviderId ?? null,
            modelRetryAt: nextRetryAt(0),
            modelRetryCount: 0,
          } as any,
        })
        scheduled = true
      } catch (err: any) {
        // Pre-migration (retry columns missing) or any write failure: do NOT
        // silently drop — fall back to a legacy ERROR row and page below.
        console.warn(`[model-retry] could not schedule retry for log ${logId} (${err?.message}); paging instead`)
        await db.messageLog.update({
          where: { id: logId },
          data: { status: 'ERROR', outboundReply: null, errorMessage },
        }).catch(() => {})
      }
    } else {
      await db.messageLog.update({
        where: { id: logId },
        data: { status: 'ERROR', outboundReply: null, errorMessage },
      }).catch(() => {})
    }
  }

  if (scheduled) {
    console.log(`[model-retry] scheduled retry for log ${logId} (${skipped}; ${skipDetail ?? 'no detail'})`)
    return { scheduled: true }
  }

  // Permanent failure, unreplayable path, or schedule-write failed → page now.
  if (workspaceId) {
    notify({
      workspaceId,
      event: 'agent_error',
      title: notice.notifyTitle,
      body: notice.notifyBody,
      severity: notice.severity,
    }).catch(() => {})
    fireWebhook({
      workspaceId,
      event: 'message.error',
      payload: { agentId: agentId ?? null, contactId, error: errorMessage },
    }).catch(() => {})
  }
  return { scheduled: false }
}

function toMessageHistory(rows: Awaited<ReturnType<typeof getMessageHistory>>): Message[] {
  return rows.map(m => ({
    id: m.id,
    conversationId: m.conversationId,
    locationId: m.locationId,
    contactId: m.contactId,
    body: m.content,
    direction: m.role === 'user' ? 'inbound' as const : 'outbound' as const,
    createdAt: m.createdAt.toISOString(),
  }))
}

export interface ModelRetryReport {
  due: number
  recovered: number
  rescheduled: number
  exhausted: number
  cancelled: number
  skippedMigration?: boolean
}

/**
 * Replay all errored inbounds whose retry is due. Safe to run every minute.
 */
export async function processModelRetries(limit = 25): Promise<ModelRetryReport> {
  const report: ModelRetryReport = { due: 0, recovered: 0, rescheduled: 0, exhausted: 0, cancelled: 0 }

  let dueRows: Array<any>
  try {
    dueRows = await db.messageLog.findMany({
      where: { status: 'ERROR', modelRetryAt: { not: null, lte: new Date() } } as any,
      orderBy: { modelRetryAt: 'asc' } as any,
      take: limit,
    })
  } catch (err: any) {
    // Retry columns not migrated yet — match the other crons' graceful skip.
    console.warn(`[model-retry] retry columns unavailable, skipping: ${err?.message}`)
    return { ...report, skippedMigration: true }
  }

  report.due = dueRows.length

  for (const row of dueRows) {
    try {
      await replayOne(row, report)
    } catch (err: any) {
      // A replay blew up unexpectedly — push the retry out one step rather
      // than hot-looping on the same row every minute.
      console.error(`[model-retry] replay error for log ${row.id}: ${err?.message}`)
      await db.messageLog.update({
        where: { id: row.id },
        data: { modelRetryAt: nextRetryAt(Math.min((row.modelRetryCount ?? 0) + 1, MAX_RETRY_ATTEMPTS)) } as any,
      }).catch(() => {})
    }
  }

  return report
}

async function clearRetry(logId: string): Promise<void> {
  await db.messageLog.update({ where: { id: logId }, data: { modelRetryAt: null } as any }).catch(() => {})
}

async function replayOne(row: any, report: ModelRetryReport): Promise<void> {
  // ── Guards: never replay something that can't or shouldn't be replayed ──
  if (!row.agentId) { await clearRetry(row.id); report.cancelled++; return }

  const agent: any = await db.agent.findUnique({
    where: { id: row.agentId },
    include: { knowledgeEntries: true },
  })
  if (!agent || !agent.isActive) { await clearRetry(row.id); report.cancelled++; return }

  // Approval-gated agents already keep a human in the loop — page instead of
  // auto-sending a reply that would bypass the approval queue.
  if (agent.requireApproval) {
    await pageExhausted(row, agent, 'approval-gated agent — left for human review')
    report.exhausted++
    return
  }

  // Human took over (conversation paused) → stop retrying silently.
  const state = await getOrCreateConversationState(agent.id, row.locationId, row.contactId, row.conversationId)
  if (state.state === 'PAUSED') { await clearRetry(row.id); report.cancelled++; return }

  // Already answered since the failure (a later inbound got a reply) → done.
  const answeredSince = await db.messageLog.count({
    where: { conversationId: row.conversationId, status: 'SUCCESS', createdAt: { gt: row.createdAt } },
  })
  if (answeredSince > 0) { await clearRetry(row.id); report.recovered++; return }

  // ── Rebuild the live prompt + history and re-run the agent ──
  const { prompt: systemPrompt, volatileContext } = await buildCrmInboundPrompt(agent, {
    contactId: row.contactId,
    inboundMessage: row.inboundMessage,
  })
  const messageHistory = toMessageHistory(await getMessageHistory(agent.id, row.contactId, 20))

  const result = await runAgent({
    locationId: row.locationId,
    agentId: agent.id,
    model: agent.model ?? undefined,
    contactId: row.contactId,
    conversationId: row.conversationId,
    conversationProviderId: row.conversationProviderId ?? undefined,
    channel: row.channel ?? 'SMS',
    incomingMessage: row.inboundMessage,
    messageHistory,
    systemPrompt,
    volatileContext,
    enabledTools: agent.enabledTools,
    qualifyingStyle: agent.qualifyingStyle ?? 'strict',
    fallback: { behavior: agent.fallbackBehavior ?? 'message', message: agent.fallbackMessage ?? null },
    persona: {
      agentPersonaName: agent.agentPersonaName,
      responseLength: agent.responseLength,
      formalityLevel: agent.formalityLevel,
      useEmojis: agent.useEmojis,
      neverSayList: agent.neverSayList,
      vocabularyRules: (agent as any).vocabularyRules,
      simulateTypos: agent.simulateTypos,
      typingDelayEnabled: agent.typingDelayEnabled,
      typingDelayMinMs: agent.typingDelayMinMs,
      typingDelayMaxMs: agent.typingDelayMaxMs,
      languages: agent.languages,
    },
  })

  // ── Interpret the outcome ──
  if (isUnansweredSkip(result.skipped)) {
    if (isRetryableSkip(result.skipped)) {
      const attempt = (row.modelRetryCount ?? 0) + 1
      if (attempt >= MAX_RETRY_ATTEMPTS) {
        await pageExhausted(row, agent, `model still unavailable after ${attempt} attempts (${result.skipDetail ?? ''})`)
        report.exhausted++
      } else {
        await db.messageLog.update({
          where: { id: row.id },
          data: {
            modelRetryCount: attempt,
            modelRetryAt: nextRetryAt(attempt),
            errorMessage: `Agent produced no reply — model_unavailable (retry ${attempt}/${MAX_RETRY_ATTEMPTS}; ${result.skipDetail ?? ''})`.slice(0, 500),
          } as any,
        }).catch(() => {})
        report.rescheduled++
      }
    } else {
      // Now a PERMANENT failure (e.g. context too long) — stop retrying, page.
      await pageExhausted(row, agent, `model rejected the request (${result.skipDetail ?? ''})`)
      report.exhausted++
    }
    return
  }

  // Success (a reply was sent by runAgent) — or the agent intentionally stayed
  // silent (reply null, no skip). Either way the inbound is resolved.
  if (result.reply) {
    await saveMessages(agent.id, row.locationId, row.contactId, row.conversationId, [
      { role: 'assistant', content: result.reply },
    ]).catch(() => {})
    if (agent.workspaceId) {
      trackMessageUsage(agent.workspaceId, agent.id).catch(() => {})
      fireWebhook({
        workspaceId: agent.workspaceId,
        event: 'message.sent',
        payload: { agentId: agent.id, contactId: row.contactId, channel: row.channel, reply: result.reply, recoveredByRetry: true },
      }).catch(() => {})
    }
    await incrementMessageCount(agent.id, row.contactId).catch(() => {})
    updateContactMemorySummary(agent.id, row.locationId, row.contactId).catch(() => {})
  }

  await db.messageLog.update({
    where: { id: row.id },
    data: {
      status: 'SUCCESS',
      outboundReply: result.reply ?? null,
      actionsPerformed: result.actionsPerformed ?? [],
      tokensUsed: result.tokensUsed ?? 0,
      modelRetryAt: null,
      errorMessage: null,
    } as any,
  }).catch(() => {})
  report.recovered++
  console.log(`[model-retry] recovered log ${row.id} on attempt ${(row.modelRetryCount ?? 0) + 1}`)
}

/** Give up on a row: clear the retry schedule and page the workspace. */
async function pageExhausted(row: any, agent: any, why: string): Promise<void> {
  await db.messageLog.update({
    where: { id: row.id },
    data: {
      modelRetryAt: null,
      errorMessage: `Agent produced no reply — ${why}. Waiting for a human.`.slice(0, 500),
    } as any,
  }).catch(() => {})
  if (agent.workspaceId) {
    notify({
      workspaceId: agent.workspaceId,
      event: 'agent_error',
      title: `${agent.name}: couldn't reply after retries`,
      body: `"${row.inboundMessage.slice(0, 120)}" is waiting for a human — ${why}.`,
      severity: 'error',
    }).catch(() => {})
    fireWebhook({
      workspaceId: agent.workspaceId,
      event: 'message.error',
      payload: { agentId: agent.id, contactId: row.contactId, error: why },
    }).catch(() => {})
  }
}
