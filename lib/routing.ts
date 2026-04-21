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

  // A single clause (optionally negated) → boolean.
  // `negate` flips the result so users can express "DOES NOT HAVE tag", etc.
  async function evalClauseMaybeNeg(c: {
    ruleType: string
    values?: string[]
    negate?: boolean
  }): Promise<boolean> {
    const raw = await evaluateClause(c.ruleType, c.values ?? [])
    return c.negate ? !raw : raw
  }

  // A single group (AND across its clauses) → boolean.
  async function evalGroup(clauses: Array<any>): Promise<boolean> {
    for (const c of clauses) {
      if (!(await evalClauseMaybeNeg(c))) return false
    }
    return true
  }

  for (const agent of eligibleAgents) {
    // Explicit deny-by-default: an agent with zero routing rules receives
    // zero inbound messages. No implicit "single agent = catch-all"
    // fallback, no legacy backwards-compat magic. If you want an agent to
    // answer everything, create an "All inbound messages" rule on the
    // Deploy tab. Logged loudly so the webhook trace in Vercel tells the
    // story when a user asks "why isn't my agent replying?".
    if (agent.routingRules.length === 0) {
      console.log(`[Routing] Agent "${agent.name}" (${agent.id}) has NO routing rules — skipping. Add at least one rule on the Deploy tab.`)
      continue
    }

    for (const rule of agent.routingRules) {
      // Shapes supported, most specific first:
      //   conditions.groups[]     → OR across groups, AND within each
      //   conditions.clauses[]    → legacy single AND group (implicit)
      //   rule.ruleType + value   → legacy single clause
      const conditions = (rule as any).conditions as
        | {
            groups?: Array<{ clauses: Array<{ ruleType: string; values?: string[]; negate?: boolean }> }>
            clauses?: Array<{ ruleType: string; values?: string[]; negate?: boolean }>
          }
        | null
        | undefined

      let matched = false
      let shape: string

      if (conditions?.groups && conditions.groups.length > 0) {
        shape = `groups(${conditions.groups.length})`
        // ANY group matches → rule matches
        for (const g of conditions.groups) {
          if (await evalGroup(g.clauses ?? [])) { matched = true; break }
        }
      } else if (conditions?.clauses && conditions.clauses.length > 0) {
        shape = `clauses(${conditions.clauses.length})`
        matched = await evalGroup(conditions.clauses)
      } else {
        // Legacy single-field shape — unchanged behavior.
        shape = `legacy(${rule.ruleType})`
        matched = await evaluateClause(rule.ruleType, rule.value ? [rule.value] : [])
      }

      console.log(
        `[Routing] Agent "${agent.name}" rule ${rule.id} (priority ${rule.priority}, ${shape}) → ${matched ? 'MATCH' : 'no match'}`,
      )

      if (matched) {
        console.log(`[Routing] ✓ Routed to agent "${agent.name}" (${agent.id})`)
        return agent as AgentWithDetails
      }
    }
  }

  console.log(`[Routing] ✗ No agent matched inbound (channel=${channel ?? 'any'}, eligible=${eligibleAgents.length})`)
  return null
}
