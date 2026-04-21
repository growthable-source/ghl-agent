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
  try {
    const updated = await db.conversationStateRecord.update({
      where: { agentId_contactId: { agentId, contactId } },
      data: { state: 'PAUSED', pauseReason: reason, pausedAt: new Date() },
    })

    // Fire needs-attention notification for human-triggered stop conditions
    try {
      const agent = await db.agent.findUnique({
        where: { id: agentId },
        select: { name: true, workspaceId: true },
      })
      if (agent?.workspaceId && reason !== 'human_takeover') {
        const { notify } = await import('./notifications')
        notify({
          workspaceId: agent.workspaceId,
          event: 'needs_attention',
          title: `${agent.name} paused a conversation`,
          body: `Reason: ${reason.replace(/_/g, ' ')} — contact ${contactId.slice(-6)} needs your attention`,
          severity: 'warning',
        }).catch(() => {})
      }
    } catch {}

    return updated
  } catch {
    console.warn(`[ConvState] No state record to pause for agent=${agentId} contact=${contactId}`)
    return null
  }
}

export async function resumeConversation(agentId: string, contactId: string) {
  return db.conversationStateRecord.update({
    where: { agentId_contactId: { agentId, contactId } },
    data: { state: 'ACTIVE', pauseReason: null, resumedAt: new Date() },
  })
}

export async function incrementMessageCount(agentId: string, contactId: string) {
  try {
    return await db.conversationStateRecord.update({
      where: { agentId_contactId: { agentId, contactId } },
      data: { messageCount: { increment: 1 } },
    })
  } catch {
    console.warn(`[ConvState] No state record to increment for agent=${agentId} contact=${contactId}`)
    return null
  }
}

export type AgentWithStopConditions = Agent & { stopConditions: StopCondition[] }

/**
 * Built-in hostile-language regex for the SENTIMENT stop condition.
 * Deliberately broad — false positives here are cheap (pause agent, flag
 * for human) while false negatives let angry contacts keep getting bot
 * replies. Operators can add extra keywords per-condition via `value`.
 */
const HOSTILE_RE = /\b(hate|hating|terrible|awful|worst|furious|furiously|frustrated|useless|scam|scammer|scamming|rip(?:ped|ping)?[\s-]?off|rip-off|fraud|fraudulent|sue|suing|lawsuit|lawyer|attorney|bbb|better\s+business\s+bureau|unacceptable|disgusting|disgusted|pathetic|incompetent|garbage|trash|horrible|horrendous|appalling|outrageous|insulting|insulted|insult|joke|complete\s+joke|what\s+a\s+joke|waste\s+of\s+(?:time|money|my)|refund\s+(?:now|immediately|asap)|cancel\s+(?:everything|immediately|now|my)|never\s+(?:again|buying|using)|ridiculous|absurd|con\s+artist|crooks?|stealing|stole|stolen|shady|fuck|fucking|shit|bullshit|damn|asshole|idiots?|stupid)\b/i

export async function checkStopConditions(
  agent: AgentWithStopConditions,
  contactId: string,
  messageBody: string,
  actionsPerformed: string[]
): Promise<{
  shouldPause: boolean
  reason: string | null
  /**
   * The specific stop condition row that tripped — callers use this to
   * execute side-effect actions (tag needs-attention, enrol/remove
   * workflow). Null if nothing matched.
   */
  matched: StopCondition | null
}> {
  const state = await getOrCreateConversationState(agent.id, agent.locationId, contactId)

  for (const cond of agent.stopConditions) {
    switch (cond.conditionType) {
      case 'APPOINTMENT_BOOKED':
        if (actionsPerformed.includes('book_appointment')) {
          return { shouldPause: true, reason: 'APPOINTMENT_BOOKED', matched: cond }
        }
        break
      case 'KEYWORD': {
        const keywords = (cond.value ?? '').split(',').map(k => k.trim().toLowerCase())
        if (keywords.some(k => messageBody.toLowerCase().includes(k))) {
          return { shouldPause: true, reason: `KEYWORD:${cond.value}`, matched: cond }
        }
        break
      }
      case 'MESSAGE_COUNT': {
        const limit = parseInt(cond.value ?? '10')
        if (state.messageCount >= limit) {
          return { shouldPause: true, reason: `MESSAGE_COUNT:${limit}`, matched: cond }
        }
        break
      }
      case 'OPPORTUNITY_STAGE':
        if (actionsPerformed.includes('move_opportunity_stage')) {
          return { shouldPause: true, reason: `OPPORTUNITY_STAGE:${cond.value}`, matched: cond }
        }
        break
      case 'SENTIMENT': {
        const body = messageBody.toLowerCase()
        // Built-in pattern first, then any operator-provided extras (same
        // comma-separated shape as KEYWORD so the UI can reuse the input).
        const extras = (cond.value ?? '').split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
        const hitBuiltIn = HOSTILE_RE.test(messageBody)
        const hitExtra = extras.some(k => body.includes(k))
        if (hitBuiltIn || hitExtra) {
          return {
            shouldPause: cond.pauseAgent,
            reason: `SENTIMENT:${hitBuiltIn ? 'hostile' : 'custom'}`,
            matched: cond,
          }
        }
        break
      }
    }
  }

  return { shouldPause: false, reason: null, matched: null }
}

/**
 * Run the side-effect actions configured on a matched StopCondition:
 *   - tag the contact with `needs-attention` so the review queue surfaces
 *     them (default ON for every new condition)
 *   - enrol the contact into a GHL workflow
 *   - remove the contact from a GHL workflow
 *
 * All three are best-effort — a missing GHL connection, a stale workflow
 * ID, or a tag-scope error never blocks the pause. Callers should invoke
 * this right after `checkStopConditions` returns a `matched` row.
 */
export async function executeStopConditionActions(params: {
  matched: StopCondition
  locationId: string
  contactId: string
  reason: string
}): Promise<void> {
  const { matched, locationId, contactId, reason } = params

  if (matched.tagNeedsAttention) {
    try {
      const { GhlAdapter } = await import('./crm/ghl/adapter')
      await new GhlAdapter(locationId).addTags(contactId, ['needs-attention'])
    } catch (err: any) {
      console.warn(`[StopCond] addTags(needs-attention) failed for ${contactId}: ${err.message}`)
    }
  }

  if (matched.enrollWorkflowId) {
    try {
      const { GhlAdapter } = await import('./crm/ghl/adapter')
      await new GhlAdapter(locationId).addContactToWorkflow(contactId, matched.enrollWorkflowId)
      console.log(`[StopCond] ${reason} → enrolled contact ${contactId} into workflow ${matched.enrollWorkflowId}`)
    } catch (err: any) {
      console.warn(`[StopCond] enrollWorkflow(${matched.enrollWorkflowId}) failed: ${err.message}`)
    }
  }

  if (matched.removeWorkflowId) {
    try {
      const { GhlAdapter } = await import('./crm/ghl/adapter')
      await new GhlAdapter(locationId).removeContactFromWorkflow(contactId, matched.removeWorkflowId)
      console.log(`[StopCond] ${reason} → removed contact ${contactId} from workflow ${matched.removeWorkflowId}`)
    } catch (err: any) {
      console.warn(`[StopCond] removeWorkflow(${matched.removeWorkflowId}) failed: ${err.message}`)
    }
  }
}
