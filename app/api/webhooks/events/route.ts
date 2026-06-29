/**
 * Webhook Event Receiver
 * POST /api/webhooks/events
 * 
 * Receives all events from the Marketplace app:
 *  - INSTALL       → save initial token context
 *  - InboundMessage → trigger AI agent
 *  - Other events   → log / handle as needed
 */

import { NextRequest, NextResponse } from 'next/server'
import { getTokens } from '@/lib/token-store'
import { getMessages } from '@/lib/crm-client'
import { runAgent } from '@/lib/ai-agent'
import { isUnansweredSkip } from '@/lib/agent/reply-skip'
import { recordUnansweredSkip } from '@/lib/model-retry'
import { processContactTrigger } from '@/lib/triggers'
import { db } from '@/lib/db'
import { findMatchingAgent } from '@/lib/routing'
import { getOrCreateConversationState, checkStopConditions, executeStopConditionActions, pauseConversation, incrementMessageCount } from '@/lib/conversation-state'
import { saveMessages, getMessageHistory, updateContactMemorySummary } from '@/lib/conversation-memory'
import { cancelFollowUpsForContact, scheduleFollowUp } from '@/lib/follow-up-scheduler'
import { debounceMessage } from '@/lib/message-debounce'
import { htmlToText } from '@/lib/html-to-text'

// CRM webhooks trigger a full agent run (Anthropic loop, tool calls, CRM
// writes). Vercel's default 10–15s ceiling kills these mid-loop, which
// previously surfaced as the agent silently failing to reply to inbound
// messages. 300s is the Vercel Pro non-Enterprise cap.
export const maxDuration = 300
import { trackMessageUsage } from '@/lib/usage'
import { evaluateApprovalNeed, recordGoalAchievements, isContactBlocked } from '@/lib/approval-rules'
import { buildCrmInboundPrompt } from '@/lib/crm-inbound-prompt'
import { fireWebhook } from '@/lib/webhooks'
import { notify } from '@/lib/notifications'
import {
  SUPPORTED_CHANNELS,
  type WebhookEventType,
  type WebhookInstallPayload,
  type WebhookMessagePayload,
} from '@/types'

// ─── Webhook signature verification ────────────────────────────────────────
//
// Same posture as the Resend inbound webhook: WEBHOOK_SECRET unset =
// accept (local dev / pre-config); SET = enforce a real HMAC-SHA256
// over the raw body. Previously this function ALWAYS returned true even
// when a secret was configured — an operator who set the secret got
// zero protection and the endpoint accepted forged events from anyone
// who knew the URL. Now setting the secret means the upstream MUST sign
// `x-webhook-signature` = hex(HMAC_SHA256(rawBody, WEBHOOK_SECRET)),
// otherwise the event is rejected 401.

import { createHmac, timingSafeEqual } from 'crypto'

function verifySignature(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) return true // not configured — accept (dev / pre-enforcement)

  const provided = req.headers.get('x-webhook-signature') ?? ''
  if (!provided) {
    console.warn('[Webhook] WEBHOOK_SECRET set but request carried no x-webhook-signature — rejecting')
    return false
  }
  // Accept either "sha256=<hex>" or a bare hex digest.
  const providedHex = provided.replace(/^sha256=/i, '').trim().toLowerCase()
  const expectedHex = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  try {
    const a = Buffer.from(providedHex, 'hex')
    const b = Buffer.from(expectedHex, 'hex')
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text()

  if (!verifySignature(req, rawBody)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType: WebhookEventType = payload.type

  console.log(`[Webhook] Received event: ${eventType}`)

  try {
    switch (eventType) {

      // ── App installed ──────────────────────────────────────────────────
      case 'INSTALL': {
        const p = payload as WebhookInstallPayload
        console.log(`[Webhook] App installed at location: ${p.locationId} (${p.companyName})`)
        // Tokens are saved via the OAuth callback — this is just for logging/setup
        // You could trigger a welcome SMS here
        break
      }

      // ── Inbound message (any channel) ──────────────────────────────────
      case 'InboundMessage': {
        const p = payload as WebhookMessagePayload
        const channel = p.messageType || 'SMS'

        console.log(`[Webhook] InboundMessage — channel=${channel} messageType=${p.messageType} location=${p.locationId} contact=${p.contactId} conv=${p.conversationId} provId=${p.conversationProviderId ?? 'none'} body="${(p.body ?? '').slice(0, 80)}"`)

        // Skip channels we don't handle (e.g. raw email without a configured agent)
        if (!SUPPORTED_CHANNELS.includes(channel as any)) {
          console.log(`[Webhook] Unsupported channel: ${channel}`)
          break
        }

        // Persist FB / IG inbounds to the unified inbox BEFORE any
        // routing / debouncing / agent gating. The thread should appear
        // even when no agent matches (the operator may want to reply
        // manually) and even when debouncing temporarily holds the
        // batch. CRM-routed inbounds (i.e. Page connected via the
        // operator's CRM marketplace, not via direct Meta OAuth) don't
        // carry a Page Access Token here — sender display name resolves
        // to a fallback until something else enriches it.
        if (channel === 'FB' || channel === 'IG') {
          try {
            const loc = await db.location.findUnique({
              where: { id: p.locationId },
              select: { workspaceId: true },
            })
            if (loc?.workspaceId) {
              const { recordInboundMetaMessage } = await import('@/lib/meta-conversation-store')
              await recordInboundMetaMessage({
                // GHL doesn't pass through Meta's page id — best stable
                // proxy is conversationProviderId (one per provider/page
                // per location), falling back to a synthesised value.
                pageId: p.conversationProviderId || `${p.locationId}:${channel}`,
                senderId: p.contactId,
                channel: channel === 'IG' ? 'instagram' : 'messenger',
                workspaceId: loc.workspaceId,
                locationId: p.locationId,
                text: p.body ?? '',
                metadata: {
                  source: 'crm-marketplace',
                  conversationId: p.conversationId,
                  conversationProviderId: p.conversationProviderId ?? null,
                },
              })
            }
          } catch (err: any) {
            console.warn('[Webhook] meta inbox persist failed:', err?.message)
          }
        }

        const tokens = await getTokens(p.locationId)
        if (!tokens) {
          console.warn(`[Webhook] No tokens for location ${p.locationId}`)
          break
        }

        // Debounce + idempotency. messageId is the GHL webhook's unique id;
        // if GHL retries the same delivery this returns null and we drop
        // it. (See lib/message-debounce.ts — duplicate prevention lives
        // there, not here.)
        const debounced = await debounceMessage(
          p.locationId, p.contactId, p.conversationId, p.body, p.messageId ?? null,
        )
        if (!debounced) {
          console.log(`[Webhook] Message debounced/deduped for contact ${p.contactId}`)
          break
        }

        // Strip HTML from email bodies (GHL sends raw HTML for email channel)
        const inboundMessage = htmlToText(debounced.combinedMessage)

        // Create pending log
        const log = await db.messageLog.create({
          data: {
            locationId: p.locationId,
            contactId: p.contactId,
            conversationId: p.conversationId,
            inboundMessage,
            status: 'PENDING',
          },
        })

        // ─── HARD PRE-FILTER ────────────────────────────────────────────
        // Before any routing machinery runs, count how many active agents
        // on this location have AT LEAST ONE routing rule. If zero, drop
        // the inbound immediately with a clear log. This is belt-and-
        // braces defence: even if findMatchingAgent had a bug or was
        // stale, this check guarantees no agent replies without explicit
        // operator intent.
        const activeAgentsWithRules = await db.agent.count({
          where: {
            locationId: p.locationId,
            isActive: true,
            routingRules: { some: {} },   // at least one rule exists
          },
        })
        if (activeAgentsWithRules === 0) {
          const hadAnyAgents = await db.agent.count({
            where: { locationId: p.locationId, isActive: true },
          })
          const reason = hadAnyAgents === 0
            ? 'No active agents on this location.'
            : `${hadAnyAgents} active agent(s) but NONE have any Deploy rules — inbound dropped by design.`
          await db.messageLog.update({
            where: { id: log.id },
            data: { status: 'SKIPPED', errorMessage: reason },
          })
          console.log(`[Webhook] ✗ Pre-filter blocked inbound: ${reason}`)
          break
        }

        // Find matching agent that is deployed on this channel
        let agent: Awaited<ReturnType<typeof findMatchingAgent>>
        try {
          agent = await findMatchingAgent(p.locationId, p.contactId, inboundMessage, channel)
        } catch (routingErr: any) {
          console.error(`[Webhook] Routing error (channel=${channel}):`, routingErr.message)
          await db.messageLog.update({
            where: { id: log.id },
            data: { status: 'ERROR', errorMessage: `Routing error: ${routingErr.message}` },
          })
          break
        }

        // ─── SECOND-LINE GUARD ──────────────────────────────────────────
        // Defense in depth: even if findMatchingAgent returned something,
        // re-check that the chosen agent actually has at least one
        // routing rule. If it doesn't, refuse to run it. This catches the
        // case where somehow a stale in-memory agent object slips
        // through with routingRules missing.
        if (agent && (!agent.routingRules || agent.routingRules.length === 0)) {
          console.error(`[Webhook] ✗ Refusing to run agent "${agent.name}" — zero routing rules despite being returned by findMatchingAgent. This is a bug; please report.`)
          await db.messageLog.update({
            where: { id: log.id },
            data: {
              agentId: agent.id,
              status: 'SKIPPED',
              errorMessage: 'Agent returned by routing engine has no Deploy rules. Pre-filter should have blocked this — treating as defensive skip.',
            },
          })
          break
        }

        if (!agent) {
          await db.messageLog.update({
            where: { id: log.id },
            data: {
              status: 'SKIPPED',
              errorMessage: 'No agent matched this inbound. Every agent on this location was either inactive, not deployed on this channel, or had no Deploy rules that matched. See Routing Diagnostic.',
            },
          })
          console.log(`[Webhook] ✗ No matching agent for location ${p.locationId} on channel ${channel} — inbound SKIPPED. See [Routing] lines above for per-agent trace.`)
          break
        }
        // Log the winner so operators can confirm the right agent caught
        // the inbound. Useful when multiple agents are competing and you
        // want to know which Deploy rule won.
        console.log(`[Webhook] ✓ Inbound routed to "${agent.name}" (${agent.id}) on channel ${channel}`)

        // ─── Emergency pause check (workspace + agent level) ───
        if (agent.workspaceId) {
          try {
            const workspace = await db.workspace.findUnique({
              where: { id: agent.workspaceId },
              select: { isPaused: true },
            })
            if (workspace?.isPaused) {
              await db.messageLog.update({
                where: { id: log.id },
                data: { agentId: agent.id, status: 'SKIPPED', errorMessage: 'Workspace paused' },
              })
              console.log(`[Webhook] Workspace paused — skipping reply for ${p.contactId}`)
              break
            }
          } catch {}
        }
        if ((agent as any).isPaused) {
          await db.messageLog.update({
            where: { id: log.id },
            data: { agentId: agent.id, status: 'SKIPPED', errorMessage: 'Agent paused' },
          })
          break
        }

        // ─── Consent check — don't reply to opted-out contacts ───
        if (agent.workspaceId && await isContactBlocked(agent.workspaceId, p.contactId, channel)) {
          await db.messageLog.update({
            where: { id: log.id },
            data: { agentId: agent.id, status: 'SKIPPED', errorMessage: `Contact opted out of ${channel}` },
          })
          console.log(`[Webhook] Contact ${p.contactId} opted out of ${channel} — skipping`)
          break
        }

        // Check conversation state
        const convState = await getOrCreateConversationState(agent.id, p.locationId, p.contactId, p.conversationId)
        if (convState.state === 'PAUSED') {
          await db.messageLog.update({ where: { id: log.id }, data: { status: 'SKIPPED', errorMessage: 'Conversation paused' } })
          break
        }

        // Cancel any scheduled follow-ups since contact replied
        await cancelFollowUpsForContact(p.locationId, p.contactId)

        // Build full system prompt with RAG. Shared with the out-of-band
        // retry path (lib/model-retry.ts) so a retried reply uses the exact
        // same prompt — booking flow, RAG, memory, persona all intact.
        const fullPrompt = await buildCrmInboundPrompt(agent, {
          contactId: p.contactId,
          inboundMessage,
        })

        // Persist the inbound user turn BEFORE running the agent. If a
        // second webhook arrives for this contact mid-run (concurrent
        // parallel delivery, or another channel event), its history read
        // will see this turn and not double-process. Also means the
        // assistant's tool loop reads its own freshly-recorded inbound on
        // any inner sub-call.
        try {
          await saveMessages(agent.id, p.locationId, p.contactId, p.conversationId, [
            { role: 'user', content: inboundMessage },
          ])
        } catch (err: any) {
          console.warn(`[Webhook] saveMessages(inbound) failed: ${err.message}`)
        }

        // Use DB history if available, otherwise fall back to GHL API
        let history: import('@/types').Message[]
        try { history = await getMessages(p.locationId, p.conversationId, 10) } catch (err: any) { console.warn(`[Webhook] Failed to fetch GHL messages: ${err.message}`); history = [] }

        const dbHistory = await getMessageHistory(agent.id, p.contactId, 20)
        const messageHistory: import('@/types').Message[] = dbHistory.length > 0
          ? dbHistory.map(m => ({
              id: m.id,
              conversationId: m.conversationId,
              locationId: m.locationId,
              contactId: m.contactId,
              body: m.content,
              direction: m.role === 'user' ? 'inbound' as const : 'outbound' as const,
              // Surface the row's createdAt so the agent can reason about
              // gaps ("contact's last reply was 4 days ago — don't repeat
              // the qualification questions you already asked").
              createdAt: m.createdAt.toISOString(),
            }))
          : history

        // ─── Approval gating: if the agent requires approval, defer the
        // actual send until rules are evaluated on the generated reply ───
        const shouldDeferForApproval = !!(agent as any).requireApproval

        try {
          const result = await runAgent({
            locationId: p.locationId,
            agentId: agent.id,
            contactId: p.contactId,
            conversationId: p.conversationId,
            conversationProviderId: p.conversationProviderId,
            channel,
            incomingMessage: inboundMessage,
            messageHistory,
            systemPrompt: fullPrompt,
            enabledTools: agent.enabledTools,
            workflowPicks: {
              addTo: ((agent as any).addToWorkflowsPick ?? undefined) as any,
              removeFrom: ((agent as any).removeFromWorkflowsPick ?? undefined) as any,
            },
            qualifyingStyle: (agent as any).qualifyingStyle ?? 'strict',
            fallback: {
              behavior: (agent as any).fallbackBehavior ?? 'message',
              message: (agent as any).fallbackMessage ?? null,
            },
            persona: {
              agentPersonaName: agent.agentPersonaName,
              responseLength: agent.responseLength,
              formalityLevel: agent.formalityLevel,
              useEmojis: agent.useEmojis,
              neverSayList: agent.neverSayList,
              simulateTypos: agent.simulateTypos,
              typingDelayEnabled: agent.typingDelayEnabled,
              typingDelayMinMs: agent.typingDelayMinMs,
              typingDelayMaxMs: agent.typingDelayMaxMs,
              languages: agent.languages,
            },
            deferSend: shouldDeferForApproval,
          })

          // ─── Unanswered skip → surface as an error, never SUCCESS ───
          // runAgent returns { reply: null, skipped } when it produced no
          // reply. For transient infra failures (model provider down / out
          // of credit) the inbound went genuinely unanswered. Falling
          // through here stamped MessageLog SUCCESS with a null reply — the
          // message was silently dropped while the inbox showed "Autopilot
          // will reply". Throw so the catch below records ERROR, pages the
          // workspace, and fires message.error; the visitor's message stays
          // visible for a human to take over.
          if (isUnansweredSkip(result.skipped)) {
            // Unanswered (model failed). A TRANSIENT failure schedules an
            // out-of-band retry (retry-model-failures cron) WITHOUT paging; a
            // PERMANENT 4xx pages a human now. Either way the inbound is never
            // stamped SUCCESS. break out of the case — do not fall through to
            // the send/approval/goal logic below.
            await recordUnansweredSkip({
              logId: log.id,
              agentId: agent.id,
              agentName: agent.name,
              workspaceId: agent.workspaceId ?? null,
              channel,
              conversationProviderId: p.conversationProviderId,
              contactId: p.contactId,
              inboundMessage,
              skipped: result.skipped,
              skipDetail: result.skipDetail,
              retrySupported: true,
            })
            break
          }

          // ─── Approval queue — flag if rules match ───
          const { needsApproval, reason: approvalReason } = evaluateApprovalNeed({
            requireApproval: shouldDeferForApproval,
            approvalRules: ((agent as any).approvalRules as any) || null,
            contactId: p.contactId,
            agentId: agent.id,
            inboundMessage,
            outboundReply: result.reply,
            priorMessageCount: convState.messageCount,
          })

          // ─── AI Judge — pre-screen flagged messages with a cheap LLM ───
          // Verdicts (per-agent config decides what to do with each):
          //   safe      → release if judgeAutoSend
          //   unsafe    → reject if judgeAutoBlock
          //   uncertain → leave for human review
          let judgeVerdict: 'safe' | 'unsafe' | 'uncertain' | null = null
          let judgeReason: string | null = null
          let judgeModel: string | null = null
          let finalNeedsApproval = needsApproval
          let autoReleasedByJudge = false
          let rejectedByJudge = false
          if (needsApproval && result.deferredCapture && (agent as any).judgeEnabled) {
            try {
              const { judgeReply } = await import('@/lib/approval-judge')
              const verdict = await judgeReply({
                inboundMessage,
                draftReply: result.deferredCapture.message,
                agentSystemPrompt: agent.systemPrompt,
                approvalReason,
                judgeInstructions: (agent as any).judgeInstructions,
                model: ((agent as any).judgeModel as 'haiku' | 'sonnet') || 'haiku',
              })
              judgeVerdict = verdict.verdict
              judgeReason = verdict.reason
              judgeModel = verdict.model
              if (verdict.verdict === 'safe' && (agent as any).judgeAutoSend) {
                finalNeedsApproval = false
                autoReleasedByJudge = true
              } else if (verdict.verdict === 'unsafe' && (agent as any).judgeAutoBlock) {
                finalNeedsApproval = false
                rejectedByJudge = true
              }
              console.log(`[Judge] ${verdict.verdict.toUpperCase()} (${verdict.latencyMs}ms): ${verdict.reason}`)
            } catch (err: any) {
              console.warn('[Judge] failed, falling back to human queue:', err.message)
            }
          }

          // ─── Release or queue the deferred send ───
          // If the agent captured a message AND approval is not required,
          // deliver it now. If approval IS required, leave captured so the
          // approvals UI can release it after human review.
          if (shouldDeferForApproval && result.deferredCapture && !finalNeedsApproval && !rejectedByJudge) {
            try {
              const { sendMessage } = await import('@/lib/crm-client')
              await sendMessage(p.locationId, {
                type: result.deferredCapture.channel as any,
                contactId: result.deferredCapture.contactId,
                conversationProviderId: result.deferredCapture.conversationProviderId,
                message: result.deferredCapture.message,
              })
              if (autoReleasedByJudge) {
                console.log(`[Approval] AUTO-RELEASED by judge for ${p.contactId} — verdict=safe`)
              } else {
                console.log(`[Approval] Auto-released captured message for ${p.contactId} (rules matched none)`)
              }
            } catch (err: any) {
              console.error('[Approval] Auto-release send failed:', err.message)
            }
          } else if (rejectedByJudge) {
            console.log(`[Approval] AUTO-REJECTED by judge: "${result.deferredCapture?.message.slice(0, 60)}..." reason=${judgeReason}`)
          } else if (finalNeedsApproval && result.deferredCapture) {
            console.log(`[Approval] HELD for approval: "${result.deferredCapture.message.slice(0, 60)}..." reason=${approvalReason}${judgeVerdict ? ` judge=${judgeVerdict}` : ''}`)
          }

          await db.messageLog.update({
            where: { id: log.id },
            data: {
              agentId: agent.id,
              outboundReply: result.reply,
              actionsPerformed: result.actionsPerformed,
              tokensUsed: result.tokensUsed,
              status: 'SUCCESS',
              toolCallTrace: result.toolCallTrace as any,
              needsApproval: finalNeedsApproval,
              approvalStatus: rejectedByJudge
                ? 'rejected_by_judge'
                : autoReleasedByJudge
                  ? 'auto_sent_by_judge'
                  : finalNeedsApproval
                    ? 'pending'
                    : (agent as any).requireApproval ? 'auto_sent' : null,
              approvalReason,
              judgeVerdict,
              judgeReason,
              judgeModel,
              // Persist channel + conversationProviderId so the approve
              // endpoint can send on the exact channel the inbound arrived on.
              ...(result.deferredCapture ? {
                approvalChannel: result.deferredCapture.channel,
                approvalConversationProviderId: result.deferredCapture.conversationProviderId || null,
              } : {}),
            } as any,
          }).catch(async () => {
            // Fallback for pre-migration DB — retry without approval fields
            await db.messageLog.update({
              where: { id: log.id },
              data: {
                agentId: agent.id,
                outboundReply: result.reply,
                actionsPerformed: result.actionsPerformed,
                tokensUsed: result.tokensUsed,
                status: 'SUCCESS',
                toolCallTrace: result.toolCallTrace as any,
              },
            })
          })

          // ─── Notify + webhooks ───
          if (needsApproval && agent.workspaceId) {
            notify({
              workspaceId: agent.workspaceId,
              event: 'approval_pending',
              title: `${agent.name} wants approval`,
              body: result.reply?.slice(0, 200) || '',
              severity: 'warning',
            }).catch(() => {})
          }
          if (agent.workspaceId) {
            fireWebhook({
              workspaceId: agent.workspaceId,
              event: 'message.sent',
              payload: {
                agentId: agent.id,
                contactId: p.contactId,
                channel,
                reply: result.reply,
                actionsPerformed: result.actionsPerformed,
                needsApproval,
              },
            }).catch(() => {})
          }

          // ─── Goal tracking — credit any wins from this turn ───
          if (result.actionsPerformed?.length) {
            recordGoalAchievements({
              agentId: agent.id,
              contactId: p.contactId,
              conversationId: p.conversationId,
              actionsPerformed: result.actionsPerformed,
              priorMessageCount: convState.messageCount,
            }).catch(() => {})

            if (result.actionsPerformed.includes('book_appointment') && agent.workspaceId) {
              fireWebhook({
                workspaceId: agent.workspaceId,
                event: 'appointment.booked',
                payload: { agentId: agent.id, contactId: p.contactId },
              }).catch(() => {})
            }
          }

          console.log(`[Agent] ${agent.name} replied to ${p.contactId}: "${result.reply?.slice(0, 60)}"`)

          // Track message usage for billing
          if (agent.workspaceId) {
            trackMessageUsage(agent.workspaceId, agent.id).catch(err =>
              console.error(`[Usage] Failed to track message:`, err.message)
            )
          }

          // Save the assistant reply to persistent history. The inbound was
          // already saved before runAgent (parallel-webhook safety), so we
          // only persist the agent's response here.
          if (result.reply) {
            await saveMessages(agent.id, p.locationId, p.contactId, p.conversationId, [
              { role: 'assistant', content: result.reply },
            ])
          }

          // Increment message count
          await incrementMessageCount(agent.id, p.contactId)

          // Check stop conditions. A matched condition runs its configured
          // side-effects (tag needs-attention + optional workflow
          // enrol/remove) regardless of whether we pause the agent — so an
          // operator can use a non-pausing SENTIMENT condition purely to
          // surface angry contacts without stopping the reply flow.
          const stopCheck = await checkStopConditions(agent as any, p.contactId, inboundMessage, result.actionsPerformed)
          if (stopCheck.matched) {
            await executeStopConditionActions({
              matched: stopCheck.matched,
              locationId: p.locationId,
              contactId: p.contactId,
              reason: stopCheck.reason ?? 'condition_met',
            }).catch(() => {})
          }
          if (stopCheck.shouldPause) {
            await pauseConversation(agent.id, p.contactId, stopCheck.reason ?? 'condition_met')
          }

          // Schedule follow-ups based on trigger rules
          if (agent.followUpSequences && agent.followUpSequences.length > 0 && !stopCheck.shouldPause) {
            for (const seq of agent.followUpSequences) {
              if (!seq.isActive) continue
              const trigger = (seq as any).triggerType ?? 'always'

              // Skip agent-triggered sequences (those are started by the schedule_followup tool)
              if (trigger === 'agent') continue

              const existingJob = await db.followUpJob.findFirst({
                where: { sequenceId: seq.id, contactId: p.contactId, status: 'SCHEDULED' },
              })
              if (existingJob) continue

              if (trigger === 'always') {
                await scheduleFollowUp(agent.id, p.locationId, p.contactId, p.conversationId, seq.id, channel)
              } else if (trigger === 'no_reply') {
                await scheduleFollowUp(agent.id, p.locationId, p.contactId, p.conversationId, seq.id, channel)
              } else if (trigger === 'keyword') {
                const keywords = ((seq as any).triggerValue ?? '').split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
                if (keywords.some((k: string) => inboundMessage.toLowerCase().includes(k))) {
                  await scheduleFollowUp(agent.id, p.locationId, p.contactId, p.conversationId, seq.id, channel)
                }
              }
            }
          }

          // Fire-and-forget memory update
          updateContactMemorySummary(agent.id, p.locationId, p.contactId).catch(() => {})

        } catch (err: any) {
          await db.messageLog.update({
            where: { id: log.id },
            data: { agentId: agent.id, status: 'ERROR', errorMessage: err.message },
          })
          console.error(`[Agent] Error:`, err)
          // Fire error notification + webhook
          if (agent.workspaceId) {
            notify({
              workspaceId: agent.workspaceId,
              event: 'agent_error',
              title: `${agent.name} errored`,
              body: err.message?.slice(0, 200) || 'Unknown error',
              severity: 'error',
            }).catch(() => {})
            fireWebhook({
              workspaceId: agent.workspaceId,
              event: 'message.error',
              payload: { agentId: agent.id, contactId: p.contactId, error: err.message },
            }).catch(() => {})
          }
        }
        break
      }

      // ── Contact events → fire agent triggers ─────────────────────────
      case 'ContactCreate': {
        const cId = payload.id ?? payload.contactId
        console.log(`[Webhook] New contact: ${cId} at ${payload.locationId}`)
        await processContactTrigger({
          eventType: 'ContactCreate',
          locationId: payload.locationId,
          contactId: cId,
          tags: payload.tags ?? [],
        })
        break
      }

      case 'ContactTagUpdate': {
        // GHL is inconsistent about where the contact ID lives on this event
        // — some accounts send `contactId`, some send `id` (matching the
        // contact-create shape). Accept both so we don't silently no-op on
        // an undefined contactId.
        const cId = payload.contactId ?? payload.id
        const tagList: string[] = Array.isArray(payload.tags) ? payload.tags : []
        if (!cId) {
          console.warn(`[Webhook] ContactTagUpdate with no contactId / id. Raw payload keys: ${Object.keys(payload).join(',')}`)
          break
        }
        console.log(`[Webhook] Tags updated — location=${payload.locationId} contact=${cId} tags=[${tagList.join(', ')}]`)
        await processContactTrigger({
          eventType: 'ContactTagUpdate',
          locationId: payload.locationId,
          contactId: cId,
          tags: tagList,
        })
        break
      }

      // ── Opportunity events ─────────────────────────────────────────────
      case 'OpportunityStageUpdate':
        console.log(`[Webhook] Opportunity stage updated: ${payload.id} → ${payload.stage?.name}`)
        break

      case 'OpportunityStatusUpdate':
        console.log(`[Webhook] Opportunity status: ${payload.id} → ${payload.status}`)
        break

      default:
        // Log a preview of unknown events so we can diagnose misnamed types
        // (e.g. a GHL account that sends `Contact Tag Update` with spaces,
        // or routes tag changes through a workflow webhook with a custom
        // `type`). Keep the preview short to avoid leaking PII in logs.
        console.log(
          `[Webhook] Unhandled event type: ${eventType} — keys=[${Object.keys(payload ?? {}).join(',')}] preview=${JSON.stringify(payload ?? {}).slice(0, 300)}`,
        )
    }
  } catch (err) {
    console.error(`[Webhook] Error handling ${eventType}:`, err)
    // Always return 200 to prevent webhook retries for non-retriable errors
  }

  // Always acknowledge receipt
  return NextResponse.json({ received: true }, { status: 200 })
}
