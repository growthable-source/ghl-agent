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
import { db } from '@/lib/db'
import { findMatchingAgent } from '@/lib/routing'
import { buildKnowledgeBlock } from '@/lib/rag'
import { getOrCreateConversationState, checkStopConditions, pauseConversation, incrementMessageCount } from '@/lib/conversation-state'
import { saveMessages, getMessageHistory, getMemorySummary, updateContactMemorySummary } from '@/lib/conversation-memory'
import { getUnansweredQuestions, buildQualifyingPromptBlock } from '@/lib/qualifying'
import { cancelFollowUpsForContact, scheduleFollowUp } from '@/lib/follow-up-scheduler'
import { debounceMessage } from '@/lib/message-debounce'
import { buildPersonaBlock } from '@/lib/persona'
import type {
  WebhookEventType,
  WebhookInstallPayload,
  WebhookMessagePayload,
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

      // ── Inbound SMS ────────────────────────────────────────────────────
      case 'InboundMessage': {
        const p = payload as WebhookMessagePayload
        if (p.messageType !== 'SMS') break

        const tokens = await getTokens(p.locationId)
        if (!tokens) {
          console.warn(`[Webhook] No tokens for location ${p.locationId}`)
          break
        }

        // Debounce rapid messages — accumulate into a single agent call
        const debounced = await debounceMessage(p.locationId, p.contactId, p.conversationId, p.body)
        if (!debounced) {
          // A newer message will handle this batch — exit quietly
          console.log(`[Webhook] Message debounced for contact ${p.contactId}, waiting for batch`)
          break
        }

        const inboundMessage = debounced.combinedMessage

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

        // Find matching agent
        const agent = await findMatchingAgent(p.locationId, p.contactId, inboundMessage)

        if (!agent) {
          await db.messageLog.update({
            where: { id: log.id },
            data: { status: 'SKIPPED' },
          })
          console.log(`[Webhook] No matching agent for location ${p.locationId}`)
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
        if (agent.instructions) fullPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
        fullPrompt += buildKnowledgeBlock(agent.knowledgeEntries, inboundMessage)

        // Inject calendar ID if booking tools are enabled and a calendar is configured
        if (agent.calendarId && agent.enabledTools.some((t: string) => ['get_available_slots', 'book_appointment'].includes(t))) {
          fullPrompt += `\n\n## Calendar Configuration\nCalendar ID for booking: ${agent.calendarId}\nAlways use this calendar ID when checking availability or booking appointments.`
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
        fullPrompt += buildPersonaBlock(agent)

        // Use DB history if available, otherwise fall back to GHL API
        let history: import('@/types').Message[]
        try { history = await getMessages(p.locationId, p.conversationId, 10) } catch { history = [] }

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

          console.log(`[Agent] ${agent.name} replied to ${p.contactId}: "${result.reply?.slice(0, 60)}"`)

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
                await scheduleFollowUp(agent.id, p.locationId, p.contactId, p.conversationId, seq.id)
              } else if (trigger === 'no_reply') {
                // Schedule a check — the first step delay acts as the silence window
                // The processDueFollowUps cron will verify silence before sending
                await scheduleFollowUp(agent.id, p.locationId, p.contactId, p.conversationId, seq.id)
              } else if (trigger === 'keyword') {
                const keywords = ((seq as any).triggerValue ?? '').split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
                if (keywords.some((k: string) => inboundMessage.toLowerCase().includes(k))) {
                  await scheduleFollowUp(agent.id, p.locationId, p.contactId, p.conversationId, seq.id)
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
        }
        break
      }

      // ── Contact events ─────────────────────────────────────────────────
      case 'ContactCreate':
        console.log(`[Webhook] New contact: ${payload.id} at ${payload.locationId}`)
        break

      case 'ContactTagUpdate':
        console.log(`[Webhook] Tags updated for contact: ${payload.contactId}`)
        break

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
