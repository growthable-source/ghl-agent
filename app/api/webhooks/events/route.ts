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
import { processContactTrigger } from '@/lib/triggers'
import { db } from '@/lib/db'
import { findMatchingAgent } from '@/lib/routing'
import { buildKnowledgeBlock } from '@/lib/rag'
import { getOrCreateConversationState, checkStopConditions, pauseConversation, incrementMessageCount } from '@/lib/conversation-state'
import { saveMessages, getMessageHistory, getMemorySummary, updateContactMemorySummary } from '@/lib/conversation-memory'
import { getUnansweredQuestions, buildQualifyingPromptBlock } from '@/lib/qualifying'
import { cancelFollowUpsForContact, scheduleFollowUp } from '@/lib/follow-up-scheduler'
import { debounceMessage } from '@/lib/message-debounce'
import { buildPersonaBlock } from '@/lib/persona'
import { htmlToText } from '@/lib/html-to-text'
import { trackMessageUsage } from '@/lib/usage'
import { evaluateApprovalNeed, recordGoalAchievements, isContactBlocked } from '@/lib/approval-rules'
import { buildObjectivesBlockForAgent } from '@/lib/agent-objectives'
import { fireWebhook } from '@/lib/webhooks'
import { notify } from '@/lib/notifications'
import {
  SUPPORTED_CHANNELS,
  type WebhookEventType,
  type WebhookInstallPayload,
  type WebhookMessagePayload,
} from '@/types'

// ─── Optional: verify webhook signature ───────────────────────────────────

function verifySignature(req: NextRequest, rawBody: string): boolean {
  const secret = process.env.WEBHOOK_SECRET
  if (!secret) return true // Skip if not configured
  const signature = req.headers.get('x-webhook-signature')
  // Implement HMAC verification here if your provider sends signatures
  return true
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

        const tokens = await getTokens(p.locationId)
        if (!tokens) {
          console.warn(`[Webhook] No tokens for location ${p.locationId}`)
          break
        }

        // Debounce rapid messages (mainly useful for SMS/chat, still safe for others)
        const debounced = await debounceMessage(p.locationId, p.contactId, p.conversationId, p.body)
        if (!debounced) {
          console.log(`[Webhook] Message debounced for contact ${p.contactId}, waiting for batch`)
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

        if (!agent) {
          await db.messageLog.update({
            where: { id: log.id },
            data: { status: 'SKIPPED' },
          })
          console.log(`[Webhook] No matching agent for location ${p.locationId} on channel ${channel}`)
          break
        }

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

        // Build full system prompt with RAG
        let fullPrompt = agent.systemPrompt
        // Primary objectives are injected FIRST (after the base prompt) so the
        // model sees them before anything else and reaches for the right tool.
        fullPrompt += await buildObjectivesBlockForAgent(agent.id, inboundMessage)
        if (agent.instructions) fullPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
        fullPrompt += buildKnowledgeBlock(agent.knowledgeEntries, inboundMessage)

        // Inject calendar ID if booking tools are enabled and a calendar is configured
        if (agent.calendarId && agent.enabledTools.some((t: string) => ['get_available_slots', 'book_appointment'].includes(t))) {
          fullPrompt += `\n\n## Calendar Configuration
Calendar ID for booking: ${agent.calendarId}
Contact ID for this conversation: ${p.contactId}

BOOKING PROCEDURE — follow this exactly when the contact wants to schedule:
1. Call \`get_available_slots\` with the Calendar ID above and a date range starting from today.
2. Propose ONE specific slot in your reply (don't list 10 — be decisive). Example: "I can do Thursday at 2pm your time — does that work?"
3. When the contact confirms ("yes", "that works", "perfect", etc.), IMMEDIATELY call \`book_appointment\` in the same turn using:
   - calendarId: ${agent.calendarId}
   - contactId: ${p.contactId}
   - startTime: the EXACT string returned by get_available_slots
4. After the tool returns success, confirm the booked time to the contact. DO NOT say "I've booked" without calling book_appointment — the booking won't exist.
5. Optionally call \`create_appointment_note\` to log context from the conversation.

CANCELLATION PROCEDURE — when the contact asks to cancel/remove/drop a meeting:
1. Call \`get_calendar_events\` with contactId=${p.contactId} to find the appointmentId.
2. Call \`cancel_appointment\` with that appointmentId. DO NOT say "I've cancelled" without calling the tool — the meeting stays on the calendar and the contact will show up.
3. Confirm cancellation to the contact after the tool returns success.

RESCHEDULE PROCEDURE — when the contact asks to move a meeting:
1. Call \`get_calendar_events\` to find the existing appointmentId.
2. Call \`get_available_slots\` for the new window the contact wants.
3. Propose one specific slot; on confirmation call \`reschedule_appointment\` with the appointmentId + exact startTime from get_available_slots.
4. Confirm the NEW time to the contact. Never say "I've moved it" without calling reschedule_appointment.`
        }

        // Memory context and qualifying questions
        const [memorySummary, unanswered] = await Promise.all([
          getMemorySummary(agent.id, p.contactId),
          getUnansweredQuestions(agent.id, p.contactId),
        ])

        if (memorySummary) {
          fullPrompt += `\n\n## Previous Conversation Context\n${memorySummary}`
        }
        fullPrompt += buildQualifyingPromptBlock(unanswered, (agent as any).qualifyingStyle ?? 'strict')
        fullPrompt += buildPersonaBlock({
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
        })

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
            }))
          : history

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
          })

          // ─── Approval queue — flag if rules match ───
          const { needsApproval, reason: approvalReason } = evaluateApprovalNeed({
            requireApproval: !!(agent as any).requireApproval,
            approvalRules: ((agent as any).approvalRules as any) || null,
            contactId: p.contactId,
            agentId: agent.id,
            inboundMessage,
            outboundReply: result.reply,
            priorMessageCount: convState.messageCount,
          })

          await db.messageLog.update({
            where: { id: log.id },
            data: {
              agentId: agent.id,
              outboundReply: result.reply,
              actionsPerformed: result.actionsPerformed,
              tokensUsed: result.tokensUsed,
              status: 'SUCCESS',
              toolCallTrace: result.toolCallTrace as any,
              needsApproval,
              approvalStatus: needsApproval ? 'pending' : (agent as any).requireApproval ? 'auto_sent' : null,
              approvalReason,
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

          // Save messages to persistent history
          await saveMessages(agent.id, p.locationId, p.contactId, p.conversationId, [
            { role: 'user', content: inboundMessage },
            ...(result.reply ? [{ role: 'assistant', content: result.reply }] : []),
          ])

          // Increment message count
          await incrementMessageCount(agent.id, p.contactId)

          // Check stop conditions
          const stopCheck = await checkStopConditions(agent as any, p.contactId, inboundMessage, result.actionsPerformed)
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
        console.log(`[Webhook] Tags updated for contact: ${payload.contactId} — tags: ${(payload.tags ?? []).join(', ')}`)
        await processContactTrigger({
          eventType: 'ContactTagUpdate',
          locationId: payload.locationId,
          contactId: payload.contactId,
          tags: payload.tags ?? [],
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
        console.log(`[Webhook] Unhandled event type: ${eventType}`)
    }
  } catch (err) {
    console.error(`[Webhook] Error handling ${eventType}:`, err)
    // Always return 200 to prevent webhook retries for non-retriable errors
  }

  // Always acknowledge receipt
  return NextResponse.json({ received: true }, { status: 200 })
}
