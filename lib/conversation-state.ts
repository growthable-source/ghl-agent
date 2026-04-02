import { db } from './db'
import type { Agent, StopCondition } from '@prisma/client'

export async function getOrCreateConversationState(agentId: string, locationId: string, contactId: string, conversationId?: string) {
  return db.conversationStateRecord.upsert({
    where: { agentId_contactId: { agentId, contactId } },
    create: { agentId, locationId, contactId, conversationId },
    update: conversationId ? { conversationId } : {},
  })
}

export async function pauseConversation(agentId: string, contactId: string, reason: string) {
  return db.conversationStateRecord.update({
    where: { agentId_contactId: { agentId, contactId } },
    data: { state: 'PAUSED', pauseReason: reason, pausedAt: new Date() },
  })
}

export async function resumeConversation(agentId: string, contactId: string) {
  return db.conversationStateRecord.update({
    where: { agentId_contactId: { agentId, contactId } },
    data: { state: 'ACTIVE', pauseReason: null, resumedAt: new Date() },
  })
}

export async function incrementMessageCount(agentId: string, contactId: string) {
  return db.conversationStateRecord.update({
    where: { agentId_contactId: { agentId, contactId } },
    data: { messageCount: { increment: 1 } },
  })
}

export type AgentWithStopConditions = Agent & { stopConditions: StopCondition[] }

export async function checkStopConditions(
  agent: AgentWithStopConditions,
  contactId: string,
  messageBody: string,
  actionsPerformed: string[]
): Promise<{ shouldPause: boolean; reason: string | null }> {
  const state = await getOrCreateConversationState(agent.id, agent.locationId, contactId)

  for (const cond of agent.stopConditions) {
    switch (cond.conditionType) {
      case 'APPOINTMENT_BOOKED':
        if (actionsPerformed.includes('book_appointment')) {
          return { shouldPause: true, reason: 'APPOINTMENT_BOOKED' }
        }
        break
      case 'KEYWORD': {
        const keywords = (cond.value ?? '').split(',').map(k => k.trim().toLowerCase())
        if (keywords.some(k => messageBody.toLowerCase().includes(k))) {
          return { shouldPause: true, reason: `KEYWORD:${cond.value}` }
        }
        break
      }
      case 'MESSAGE_COUNT': {
        const limit = parseInt(cond.value ?? '10')
        if (state.messageCount >= limit) {
          return { shouldPause: true, reason: `MESSAGE_COUNT:${limit}` }
        }
        break
      }
      case 'OPPORTUNITY_STAGE':
        if (actionsPerformed.includes('move_opportunity_stage')) {
          return { shouldPause: true, reason: `OPPORTUNITY_STAGE:${cond.value}` }
        }
        break
    }
  }

  return { shouldPause: false, reason: null }
}
