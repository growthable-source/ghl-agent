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
  // Resolve the Location's CURRENT workspaceId. Routing must be scoped
  // to it, otherwise agents that were tagged to a previous workspace
  // (before a reinstall rebound the Location) still fire — the
  // "ghost agent" bug. The OAuth callback now cascades Agent.workspaceId
  // on rebind, but this filter is belt-and-braces against any historic
  // drift or future write paths that miss the cascade.
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { workspaceId: true },
  })

  // Build the agent where-clause. We always pin to the Location's
  // workspaceId — including null. An agent's workspaceId must match
  // the Location's workspaceId for the agent to be eligible.
  const agentWhere = {
    locationId,
    isActive: true,
    workspaceId: location?.workspaceId ?? null,
  } as const

  // Deterministic ordering. Without orderBy, Prisma's default is the
  // database's storage order which isn't guaranteed stable, so when
  // two agents on a Location both have rules that match an inbound,
  // the winner was random. createdAt-asc means the oldest agent wins
  // ties — predictable and easy to reason about.
  const agentOrder = { createdAt: 'asc' as const }

  // Try the full query first. Two known-fallback cases:
  //   1. ChannelDeployment table missing (P2021) — pre-channels-migration DBs
  //   2. Workspace.brokenReferenceMode column missing (P2022) — Phase A
  //      SQL not yet applied. Critical: without this fallback, EVERY
  //      inbound's routing query throws and no agent runs.
  //
  // We try the maximal include first; on either fallback we degrade
  // gracefully and synthesise empty values so downstream logic doesn't
  // need to special-case migration state.
  const isUnknownColumnError = (err: any) =>
    err?.code === 'P2022' ||
    /column .* does not exist|brokenReferenceMode|toolAutonomyMode|presetId/i.test(err?.message ?? '')
  const isChannelDeploymentsError = (err: any) =>
    err?.code === 'P2021' ||
    /channelDeployments|ChannelDeployment/.test(err?.message ?? '')

  let agents: any[]
  try {
    agents = await db.agent.findMany({
      where: agentWhere,
      orderBy: agentOrder,
      include: {
        routingRules: { orderBy: { priority: 'asc' } },
        stopConditions: true,
        followUpSequences: { where: { isActive: true } },
        qualifyingQuestions: true,
        channelDeployments: true,
        workspace: { select: { brokenReferenceMode: true } },
      },
    })
  } catch (err: any) {
    if (isUnknownColumnError(err)) {
      // Phase A SQL not applied yet — query without the workspace include.
      // agent_pause mode is unreachable until the column exists, which is
      // the correct degraded behaviour.
      console.warn(`[Routing] Workspace.brokenReferenceMode column not migrated yet, falling back without it`)
      try {
        agents = await db.agent.findMany({
          where: agentWhere,
          orderBy: agentOrder,
          include: {
            routingRules: { orderBy: { priority: 'asc' } },
            stopConditions: true,
            followUpSequences: { where: { isActive: true } },
            qualifyingQuestions: true,
            channelDeployments: true,
          },
        })
      } catch (inner: any) {
        // Maybe channelDeployments ALSO doesn't exist. Strip it too.
        if (isChannelDeploymentsError(inner)) {
          console.warn(`[Routing] ChannelDeployment table also missing — falling back to bare agent query`)
          agents = await db.agent.findMany({
            where: agentWhere,
            orderBy: agentOrder,
            include: {
              routingRules: { orderBy: { priority: 'asc' } },
              stopConditions: true,
              followUpSequences: { where: { isActive: true } },
              qualifyingQuestions: true,
            },
          })
          agents = agents.map((a: any) => ({ ...a, channelDeployments: [] }))
        } else {
          throw inner
        }
      }
    } else if (isChannelDeploymentsError(err)) {
      console.warn(`[Routing] ChannelDeployment table may not exist yet, querying without it`)
      try {
        agents = await db.agent.findMany({
          where: agentWhere,
          orderBy: agentOrder,
          include: {
            routingRules: { orderBy: { priority: 'asc' } },
            knowledgeEntries: true,
            stopConditions: true,
            followUpSequences: { where: { isActive: true } },
            qualifyingQuestions: true,
            workspace: { select: { brokenReferenceMode: true } },
          },
        })
      } catch (inner: any) {
        // BOTH the channelDeployments table AND the brokenReferenceMode
        // column missing. Strip the workspace include too — agent_pause
        // mode is unreachable until the column lands but routing keeps
        // working in degraded mode, which is the whole point of this
        // fallback chain.
        if (isUnknownColumnError(inner)) {
          console.warn(`[Routing] Workspace.brokenReferenceMode also missing — falling back to bare query`)
          agents = await db.agent.findMany({
            where: agentWhere,
            orderBy: agentOrder,
            include: {
              routingRules: { orderBy: { priority: 'asc' } },
              knowledgeEntries: true,
              stopConditions: true,
              followUpSequences: { where: { isActive: true } },
              qualifyingQuestions: true,
            },
          })
        } else {
          throw inner
        }
      }
      agents = agents.map((a: any) => ({ ...a, channelDeployments: [] }))
    } else {
      throw err
    }
  }

  if (agents.length === 0) {
    console.log(`[Routing] No active agents found for location ${locationId}`)
    return null
  }

  // Hydrate `knowledgeEntries` via the workspace junction so each agent
  // sees both its own + any workspace-shared entries it's connected to.
  // The legacy `agent.knowledgeEntries` FK is gone; the junction is now
  // the single source of truth.
  const { bulkLoadKnowledgeForAgents } = await import('./knowledge')
  const knowledgeByAgent = await bulkLoadKnowledgeForAgents(agents.map(a => a.id))
  for (const a of agents) {
    a.knowledgeEntries = knowledgeByAgent.get(a.id) ?? []
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
      try {
        contact = await getContact(locationId, contactId)
      } catch (err: any) {
        // CRITICAL observability — when contact fetch fails (expired
        // token, GHL outage, rate limit) every TAG/PIPELINE_STAGE
        // clause silently can't match, the agent "doesn't fire", and
        // the operator has no breadcrumb. Log it so the inevitable
        // support ticket can be answered from Vercel logs.
        console.error('[Routing] contact fetch failed', { locationId, contactId, err: err?.message })
        contact = null
      }
    }
    return contact
  }

  const getOpportunities = async () => {
    if (!opportunities) {
      try {
        opportunities = await getOpportunitiesForContact(locationId, contactId)
      } catch (err: any) {
        console.error('[Routing] opportunities fetch failed', { locationId, contactId, err: err?.message })
        opportunities = []
      }
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

    // ── Reference-health gate: when the workspace is in 'agent_pause' mode
    // and this agent has any broken references, skip it entirely. Other
    // modes (tool_disable, warn_only) are handled inside runAgent.
    const wsMode = (agent.workspace as any)?.brokenReferenceMode ?? 'tool_disable'
    if (wsMode === 'agent_pause') {
      try {
        const brokenCount = await db.agentReferenceHealth.count({
          where: { agentId: agent.id, status: 'broken' },
        })
        if (brokenCount > 0) {
          console.log(`[routing] skipping agent ${agent.id}: ${brokenCount} broken refs (mode=agent_pause)`)
          continue
        }
      } catch (err: any) {
        console.warn(`[routing] reference-health check failed for agent ${agent.id}: ${err?.message}`)
        // Fail open — don't block routing on a transient DB hiccup.
      }
    }

    for (const rule of agent.routingRules) {
      // Per-channel rule scoping. channels[] = empty preserves the
      // legacy behaviour (rule applies on every channel this agent
      // listens on via ChannelDeployment). Non-empty restricts the
      // rule to inbounds whose channel is in the list — this is what
      // makes "All inbound SMS + only FB with tag X" expressible as
      // two rules on one agent.
      const ruleChannels = ((rule as any).channels as string[] | null | undefined) ?? []
      if (ruleChannels.length > 0 && channel && !ruleChannels.includes(channel)) {
        console.log(`[Routing] Agent "${agent.name}" rule ${rule.id} scoped to ${ruleChannels.join(',')} — skipping for inbound channel ${channel}`)
        continue
      }

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
