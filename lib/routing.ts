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
  let agents: any[]
  try {
    agents = await db.agent.findMany({
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
  } catch (err: any) {
    // If ChannelDeployment table doesn't exist yet, fall back without it
    if (err.message?.includes('channelDeployments') || err.code === 'P2021') {
      console.warn(`[Routing] ChannelDeployment table may not exist yet, querying without it`)
      agents = await db.agent.findMany({
        where: { locationId, isActive: true },
        include: {
          routingRules: { orderBy: { priority: 'asc' } },
          knowledgeEntries: true,
          stopConditions: true,
          followUpSequences: { where: { isActive: true } },
          qualifyingQuestions: true,
        },
      })
      // Add empty channelDeployments so backward compat logic works
      agents = agents.map((a: any) => ({ ...a, channelDeployments: [] }))
    } else {
      throw err
    }
  }

  if (agents.length === 0) {
    console.log(`[Routing] No active agents found for location ${locationId}`)
    return null
  }

  console.log(`[Routing] Found ${agents.length} active agent(s) for location ${locationId}, filtering for channel=${channel ?? 'any'}`)

  // Filter agents that are deployed on this channel (if channel is specified)
  const eligibleAgents = channel
    ? agents.filter(a => {
        // If no deployments configured, agent responds to all channels (backward compat)
        if (a.channelDeployments.length === 0) {
          console.log(`[Routing] Agent "${a.name}" has no channel deployments — eligible for all channels`)
          return true
        }
        const match = a.channelDeployments.some((d: any) => d.channel === channel && d.isActive)
        console.log(`[Routing] Agent "${a.name}" deployments: [${a.channelDeployments.map((d: any) => `${d.channel}(${d.isActive ? 'on' : 'off'})`).join(', ')}] → ${match ? 'ELIGIBLE' : 'FILTERED OUT'} for channel ${channel}`)
        return match
      })
    : agents

  if (eligibleAgents.length === 0) {
    console.log(`[Routing] No eligible agents after channel filter for channel=${channel}`)
    return null
  }

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

  // ── Evaluate a single clause (one ruleType + one or more acceptable values)
  //    Values are OR'd — any matching value makes the clause match.
  async function evaluateClause(ruleType: string, values: string[]): Promise<boolean> {
    switch (ruleType) {
      case 'ALL':
        return true

      case 'TAG': {
        const c = await getContactData()
        const tags = c?.tags ?? []
        return values.some(v => tags.includes(v))
      }

      case 'PIPELINE_STAGE': {
        const opps = await getOpportunities()
        return values.some(v => opps.some((o: any) => o.pipelineStageId === v))
      }

      case 'KEYWORD': {
        const body = messageBody.toLowerCase()
        // Each `value` may itself be a comma-separated list (legacy convenience).
        // Flatten then match any keyword against the message body.
        const keywords = values
          .flatMap(v => v.split(','))
          .map(k => k.trim().toLowerCase())
          .filter(Boolean)
        return keywords.some(k => body.includes(k))
      }

      default:
        return false
    }
  }

  for (const agent of eligibleAgents) {
    for (const rule of agent.routingRules) {
      // New shape: compound conditions. All clauses must match (AND); values
      // within a clause are OR'd (handled by evaluateClause).
      const conditions = (rule as any).conditions as
        | { clauses?: Array<{ ruleType: string; values?: string[] }> }
        | null
        | undefined

      let matched = false

      if (conditions?.clauses && conditions.clauses.length > 0) {
        matched = true
        for (const clause of conditions.clauses) {
          const ok = await evaluateClause(clause.ruleType, clause.values ?? [])
          if (!ok) { matched = false; break }
        }
      } else {
        // Legacy single-field shape — unchanged behavior.
        // A single `value` becomes a one-element list so it flows through the
        // same evaluator.
        matched = await evaluateClause(rule.ruleType, rule.value ? [rule.value] : [])
      }

      if (matched) return agent as AgentWithDetails
    }
  }

  return null
}
