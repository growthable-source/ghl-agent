/**
 * Trigger Processor
 * Handles ContactCreate and ContactTagUpdate webhook events
 * by finding matching AgentTriggers and sending first messages.
 */

import { db } from './db'
import { getContact, sendMessage } from './crm-client'
import { runAgent } from './ai-agent'
import { getTokens } from './token-store'
import { saveMessages } from './conversation-memory'
import { getOrCreateConversationState } from './conversation-state'
import { buildKnowledgeBlock } from './rag'
import { buildPersonaBlock } from './persona'
import { isWithinWorkingHours, shiftToWorkingHours } from './working-hours'
import type { MessageChannelType } from '@/types'

interface TriggerEvent {
  eventType: 'ContactCreate' | 'ContactTagUpdate'
  locationId: string
  contactId: string
  tags: string[]
}

export async function processContactTrigger(event: TriggerEvent) {
  const { eventType, locationId, contactId, tags } = event

  // 1. Verify tokens exist for this location
  const tokens = await getTokens(locationId)
  if (!tokens) {
    console.log(`[Trigger] No tokens for location ${locationId}, skipping`)
    return
  }

  // 2. Find all matching triggers across all agents for this location
  let triggers: any[]
  try {
    triggers = await db.agentTrigger.findMany({
      where: {
        eventType,
        isActive: true,
        agent: { locationId, isActive: true },
      },
      include: {
        agent: {
          include: {
            knowledgeEntries: true,
            channelDeployments: true,
          },
        },
      },
    })
  } catch (err: any) {
    // If AgentTrigger table doesn't exist yet, skip gracefully
    if (err.code === 'P2021' || err.message?.includes('AgentTrigger')) {
      console.warn(`[Trigger] AgentTrigger table may not exist yet, skipping`)
      return
    }
    throw err
  }

  if (triggers.length === 0) {
    console.log(`[Trigger] No matching triggers for ${eventType} at location ${locationId}`)
    return
  }

  console.log(`[Trigger] Found ${triggers.length} trigger(s) for ${eventType} at location ${locationId}`)

  // 3. Deduplicate — check if we already sent a trigger message to this contact recently
  const recentTriggerLog = await db.messageLog.findFirst({
    where: {
      locationId,
      contactId,
      inboundMessage: { startsWith: '[Trigger:' },
      status: 'SUCCESS',
      createdAt: { gte: new Date(Date.now() - 60_000) }, // within last 60s
    },
  })
  if (recentTriggerLog) {
    console.log(`[Trigger] Already sent a trigger message to contact ${contactId} within 60s, skipping duplicates`)
    return
  }

  for (const trigger of triggers) {
    const agent = trigger.agent

    // 4. Tag filter check
    if (trigger.eventType === 'ContactTagUpdate' && trigger.tagFilter) {
      if (!tags.includes(trigger.tagFilter)) {
        console.log(`[Trigger] Tag filter "${trigger.tagFilter}" not in tags [${tags.join(', ')}], skipping trigger ${trigger.id}`)
        continue
      }
    }

    // 5. Verify agent is deployed on the trigger's channel (if it has deployments)
    if (agent.channelDeployments.length > 0) {
      const deployed = agent.channelDeployments.some(
        (d: any) => d.channel === trigger.channel && d.isActive
      )
      if (!deployed) {
        console.log(`[Trigger] Agent "${agent.name}" not deployed on channel ${trigger.channel}, skipping`)
        continue
      }
    }

    // 5b. Working hours guard — triggers are PROACTIVE (agent reaches out
    // first), so they must respect the agent's working window. If outside
    // the window, record a pending-trigger row that re-fires when hours open.
    // (Inbound replies don't go through this path — they respond to an active
    // contact conversation and always send immediately.)
    if ((agent as any).workingHoursEnabled) {
      const whCfg = {
        workingHoursEnabled: true,
        workingHoursStart: (agent as any).workingHoursStart ?? 0,
        workingHoursEnd: (agent as any).workingHoursEnd ?? 24,
        workingDays: (agent as any).workingDays ?? ['mon','tue','wed','thu','fri','sat','sun'],
        timezone: (agent as any).timezone ?? null,
      }
      if (!isWithinWorkingHours(whCfg)) {
        const nextSendAt = shiftToWorkingHours(whCfg, new Date())
        console.log(`[Trigger] Outside working hours for agent "${agent.name}" — deferring until ${nextSendAt.toISOString()}`)
        // Log the skip so the dashboard shows what happened
        try {
          await db.messageLog.create({
            data: {
              locationId, agentId: agent.id, contactId,
              conversationId: '',
              inboundMessage: `[Trigger: ${eventType}${trigger.tagFilter ? ` tag=${trigger.tagFilter}` : ''}]`,
              status: 'SKIPPED',
              errorMessage: `Outside working hours — would have fired at ${nextSendAt.toISOString()}. Triggers do not auto-defer; manually re-fire or wait for next matching event.`,
            },
          })
        } catch {}
        continue
      }
    }

    try {
      // 6. Fetch contact details for context
      let contact: any = null
      try {
        contact = await getContact(locationId, contactId)
      } catch (err: any) {
        console.warn(`[Trigger] Could not fetch contact ${contactId}: ${err.message}`)
      }

      const contactName = contact
        ? [contact.firstName, contact.lastName].filter(Boolean).join(' ') || 'there'
        : 'there'

      console.log(`[Trigger] Firing trigger ${trigger.id} (${trigger.messageMode}) for agent "${agent.name}" → contact ${contactId} on ${trigger.channel}`)

      if (trigger.messageMode === 'FIXED' && trigger.fixedMessage) {
        // ── FIXED MODE: send static message directly ──
        const result = await sendMessage(locationId, {
          type: trigger.channel as MessageChannelType,
          contactId,
          message: trigger.fixedMessage,
        })

        await db.messageLog.create({
          data: {
            locationId,
            agentId: agent.id,
            contactId,
            conversationId: result.conversationId || '',
            inboundMessage: `[Trigger: ${eventType}${trigger.tagFilter ? ` tag=${trigger.tagFilter}` : ''}]`,
            outboundReply: trigger.fixedMessage,
            actionsPerformed: ['trigger_fixed_message'],
            status: 'SUCCESS',
          },
        })

        // Save to conversation history so future messages have context
        if (result.conversationId) {
          await saveMessages(agent.id, locationId, contactId, result.conversationId, [
            { role: 'assistant', content: trigger.fixedMessage },
          ])
        }

        console.log(`[Trigger] Sent fixed message to ${contactId}: "${trigger.fixedMessage.slice(0, 60)}"`)

      } else {
        // ── AI_GENERATE MODE: run the agent with context ──
        let fullPrompt = agent.systemPrompt
        if (agent.instructions) fullPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
        fullPrompt += buildKnowledgeBlock(agent.knowledgeEntries, '')

        // Add trigger-specific context
        fullPrompt += `\n\n## Trigger Context`
        fullPrompt += `\nThis is an OUTBOUND trigger — the contact did NOT message you first.`
        fullPrompt += `\nEvent: ${eventType === 'ContactCreate' ? 'A new contact was just created (e.g. form submission, import)' : `The tag "${trigger.tagFilter || 'unknown'}" was just added to this contact`}.`
        if (contact) {
          fullPrompt += `\nContact name: ${contactName}`
          if (contact.email) fullPrompt += `\nContact email: ${contact.email}`
          if (contact.phone) fullPrompt += `\nContact phone: ${contact.phone}`
          if (contact.tags?.length) fullPrompt += `\nContact tags: ${contact.tags.join(', ')}`
          if (contact.source) fullPrompt += `\nContact source: ${contact.source}`
        }
        if (trigger.aiInstructions) {
          fullPrompt += `\n\nSpecial instructions for this trigger:\n${trigger.aiInstructions}`
        }
        fullPrompt += `\n\nIMPORTANT: Send a single, friendly first message to this contact using the send_reply tool. Do NOT ask them to repeat information they already provided. Keep it concise and natural.`
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

        // Synthetic inbound message to kickstart the agent
        const syntheticMessage = eventType === 'ContactCreate'
          ? `[System trigger: New contact created — ${contactName}. Send them a first message.]`
          : `[System trigger: Tag "${trigger.tagFilter || ''}" added to contact ${contactName}. Send them a first message.]`

        const result = await runAgent({
          locationId,
          agentId: agent.id,
          contactId,
          channel: trigger.channel,
          incomingMessage: syntheticMessage,
          messageHistory: [],
          systemPrompt: fullPrompt,
          enabledTools: agent.enabledTools,
          workflowPicks: {
            addTo: ((agent as any).addToWorkflowsPick ?? undefined) as any,
            removeFrom: ((agent as any).removeFromWorkflowsPick ?? undefined) as any,
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

        await db.messageLog.create({
          data: {
            locationId,
            agentId: agent.id,
            contactId,
            conversationId: '',
            inboundMessage: `[Trigger: ${eventType}${trigger.tagFilter ? ` tag=${trigger.tagFilter}` : ''}]`,
            outboundReply: result.reply,
            actionsPerformed: ['trigger_ai_generate', ...result.actionsPerformed],
            tokensUsed: result.tokensUsed,
            status: 'SUCCESS',
          },
        })

        console.log(`[Trigger] AI sent message to ${contactId}: "${(result.reply ?? '').slice(0, 60)}"`)
      }

      // Initialize conversation state so future inbound messages route to this agent
      try {
        await getOrCreateConversationState(agent.id, locationId, contactId)
      } catch { /* non-critical */ }

    } catch (err: any) {
      console.error(`[Trigger] Error processing trigger ${trigger.id}:`, err.message)
      try {
        await db.messageLog.create({
          data: {
            locationId,
            agentId: agent.id,
            contactId,
            conversationId: '',
            inboundMessage: `[Trigger: ${eventType}]`,
            status: 'ERROR',
            errorMessage: err.message,
          },
        })
      } catch { /* logging failed, move on */ }
    }
  }
}
