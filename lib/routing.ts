import { db } from './db'
import { getContact, getOpportunitiesForContact } from './crm-client'
import type { Agent, KnowledgeEntry, RoutingRule, StopCondition, FollowUpSequence, QualifyingQuestion, ChannelDeployment } from '@prisma/client'

export type AgentWithDetails = Agent & {
  knowledgeEntries: KnowledgeEntry[]
  routingRules: RoutingRule[]
  stopConditions: StopCondition[]
  followUpSequences: FollowUpSequence[]
  qualifyingQuestions: QualifyingQuestion[]
  channelDeployments: ChannelDeployment[]
}

export async function findMatchingAgent(
  locationId: string,
  contactId: string,
  messageBody: string,
  channel?: string
): Promise<AgentWithDetails | null> {
  const agents = await db.agent.findMany({
    where: { locationId, isActive: true },
    include: {
      routingRules: { orderBy: { priority: 'asc' } },
      knowledgeEntries: true,
      stopConditions: true,
      followUpSequences: { where: { isActive: true } },
      qualifyingQuestions: true,
      channelDeployments: true,
    },
  })

  if (agents.length === 0) return null

  // Filter agents that are deployed on this channel (if channel is specified)
  const eligibleAgents = channel
    ? agents.filter(a => {
        // If no deployments configured, agent responds to all channels (backward compat)
        if (a.channelDeployments.length === 0) return true
        return a.channelDeployments.some(d => d.channel === channel && d.isActive)
      })
    : agents

  if (eligibleAgents.length === 0) return null

  // Lazy-load contact and opportunities — only fetch once each if needed
  let contact: Awaited<ReturnType<typeof getContact>> | null = null
  let opportunities: Awaited<ReturnType<typeof getOpportunitiesForContact>> | null = null

  const getContactData = async () => {
    if (!contact) {
      try { contact = await getContact(locationId, contactId) } catch { contact = null }
    }
    return contact
  }

  const getOpportunities = async () => {
    if (!opportunities) {
      try { opportunities = await getOpportunitiesForContact(locationId, contactId) } catch { opportunities = [] }
    }
    return opportunities ?? []
  }

  for (const agent of eligibleAgents) {
    for (const rule of agent.routingRules) {
      let matched = false

      switch (rule.ruleType) {
        case 'ALL':
          matched = true
          break

        case 'TAG': {
          const c = await getContactData()
          matched = !!(c?.tags?.includes(rule.value ?? ''))
          break
        }

        case 'PIPELINE_STAGE': {
          const opps = await getOpportunities()
          matched = opps.some((o) => o.pipelineStageId === rule.value)
          break
        }

        case 'KEYWORD': {
          const keywords = (rule.value ?? '')
            .split(',')
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean)
          const body = messageBody.toLowerCase()
          matched = keywords.some((k) => body.includes(k))
          break
        }
      }

      if (matched) return agent as AgentWithDetails
    }
  }

  return null
}
