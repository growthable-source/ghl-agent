/**
 * buildAgentFlow — assembles the visual workflow graph for one agent.
 *
 * Pulls every relation that affects what the agent does:
 *   - Channel triggers (ChannelDeployment where isActive=true)
 *   - CRM event triggers (AgentTrigger rows)
 *   - Routing rules (RoutingRule rows) — filters on which messages reach tools
 *   - Working hours gate (when Agent.workingHoursEnabled)
 *   - Stop conditions (StopCondition rows)
 *   - Tools (AGENT_TOOLS × AgentToolConfig — enabled only)
 *   - B3 gate markers (catalog enforcement === 'enforced')
 *   - onFailure endpoints (one per distinct non-default onFailure mode)
 *   - Pause / handover endpoints
 *   - Follow-ups (FollowUpSequence rows)
 *
 * Phase 1 simplification: every routing filter connects to every enabled
 * tool (no per-rule channel scoping in the edges yet — we tighten in a
 * later phase). Playbook nodes are not emitted because the Playbook
 * model isn't in the schema yet.
 *
 * The output is a FlowResponse ready to feed React Flow.
 */

import { db } from '@/lib/db'
import { AGENT_TOOLS } from '@/lib/agent/tool-catalog'
import { resolveAgentToolConfig } from '@/lib/agent/tool-config'
import { autoLayout } from './layout'
import type { FlowEdge, FlowNode, FlowResponse } from './types'

const CHANNEL_LABELS: Record<string, string> = {
  SMS: 'SMS',
  WhatsApp: 'WhatsApp',
  GMB: 'Google Business',
  FB: 'Facebook',
  IG: 'Instagram',
  Live_Chat: 'Live Chat',
  Email: 'Email',
}

const TRIGGER_EVENT_LABELS: Record<string, string> = {
  ContactCreate: 'New contact',
  ContactTagUpdate: 'Tag added',
}

const ON_FAILURE_LABELS: Record<string, { key: string; label: string }> = {
  transfer_to_human: { key: 'failure:transfer', label: 'Transfer to human' },
  canned_message: { key: 'failure:canned', label: 'Canned message' },
  silent_skip: { key: 'failure:silent', label: 'Silent skip' },
}

/**
 * Tools whose useWhen/onFailure dispatch ultimately calls into the CRM's
 * calendar API. If the agent's selected calendar is broken (no longer
 * exists upstream), these specific tool nodes get the red corner badge —
 * even if we don't have direct FK rows for them.
 */
const CALENDAR_DEPENDENT_TOOLS = new Set<string>([
  'get_available_slots',
  'book_appointment',
  'cancel_appointment',
  'reschedule_appointment',
  'get_calendar_events',
  'create_appointment_note',
])

/**
 * Tool names that take a workflow id as their argument. When the
 * referenced workflow is broken, only THESE tool nodes get the badge —
 * not every workflow-touching tool in the catalog.
 */
const WORKFLOW_TOOLS = new Set<string>([
  'add_to_workflow',
  'remove_from_workflow',
])

function toolLabel(toolName: string): string {
  // human-ish — strip underscores, title-case first word
  const spaced = toolName.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function routingRuleLabel(rule: {
  ruleType: string
  value: string | null
  conditions: unknown
}): string {
  // Prefer compound-conditions summary when present
  const c = rule.conditions as { clauses?: Array<{ ruleType?: string; values?: string[] }> } | null
  if (c && Array.isArray(c.clauses) && c.clauses.length > 0) {
    const parts = c.clauses
      .map(cl => {
        const vals = (cl.values ?? []).join(', ')
        return cl.ruleType ? `${cl.ruleType}: ${vals}` : vals
      })
      .filter(Boolean)
    if (parts.length > 0) return parts.join(' AND ')
  }
  if (rule.ruleType === 'ALL') return 'All inbound'
  if (rule.value) return `${rule.ruleType.toLowerCase()} = ${rule.value}`
  return rule.ruleType.toLowerCase()
}

function stopConditionLabel(sc: {
  conditionType: string
  value: string | null
}): string {
  switch (sc.conditionType) {
    case 'APPOINTMENT_BOOKED': return 'Appointment booked'
    case 'KEYWORD': return sc.value ? `Keyword: ${sc.value}` : 'Keyword match'
    case 'MESSAGE_COUNT': return sc.value ? `After ${sc.value} messages` : 'Message count'
    case 'OPPORTUNITY_STAGE': return sc.value ? `Opp stage: ${sc.value}` : 'Opp stage'
    case 'SENTIMENT': return 'Hostile sentiment'
    default: return sc.conditionType
  }
}

export async function buildAgentFlow(agentId: string): Promise<FlowResponse> {
  // ── Single load of every agent relation we need ────────────────────────
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: {
      channelDeployments: { where: { isActive: true } },
      triggers: { where: { isActive: true } },
      routingRules: { orderBy: { priority: 'asc' } },
      stopConditions: true,
      followUpSequences: { where: { isActive: true } },
      nodeLayouts: true,
    },
  })

  if (!agent) {
    return { nodes: [], edges: [], viewMode: 'simple' }
  }

  // Per-tool resolved config (catalog defaults + DB overrides)
  const resolvedTools = await resolveAgentToolConfig(agentId)

  // The agent's enabledTools list still gates which tools surface in the
  // graph — AgentToolConfig.enabled can override but we use the union of
  // (enabledTools OR a config row with enabled=true).
  const enabledNames = new Set<string>(agent.enabledTools)
  for (const cfg of resolvedTools.values()) {
    if (cfg.enabled) enabledNames.add(cfg.toolName)
  }

  // Catalog lookup
  const catalogByName = new Map(AGENT_TOOLS.map(t => [t.name, t]))

  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []
  let edgeSeq = 0
  const nextEdgeId = () => `e${++edgeSeq}`

  // ── Trigger nodes ───────────────────────────────────────────────────────
  const triggerKeys: string[] = []

  for (const ch of agent.channelDeployments) {
    const key = `channel:${ch.channel}`
    nodes.push({
      id: key,
      type: 'channelTrigger',
      data: {
        label: CHANNEL_LABELS[ch.channel] ?? ch.channel,
        sourceId: ch.id,
        meta: { channel: ch.channel },
      },
      position: { x: 0, y: 0 },
    })
    triggerKeys.push(key)
  }

  for (const t of agent.triggers) {
    const key = `trigger:${t.id}`
    const evt = TRIGGER_EVENT_LABELS[t.eventType] ?? t.eventType
    const label = t.tagFilter ? `${evt} (#${t.tagFilter})` : evt
    nodes.push({
      id: key,
      type: 'crmTrigger',
      data: {
        label,
        sourceId: t.id,
        meta: {
          eventType: t.eventType,
          channel: t.channel,
          messageMode: t.messageMode,
        },
      },
      position: { x: 0, y: 0 },
    })
    triggerKeys.push(key)
  }

  // ── Filter nodes (routing + working hours) ─────────────────────────────
  const filterKeys: string[] = []

  if (agent.workingHoursEnabled) {
    const key = 'working_hours:default'
    nodes.push({
      id: key,
      type: 'workingHours',
      data: {
        label: `Working hours ${agent.workingHoursStart}:00–${agent.workingHoursEnd}:00`,
        meta: {
          days: agent.workingDays,
          timezone: agent.timezone,
        },
      },
      position: { x: 0, y: 0 },
    })
    filterKeys.push(key)
  }

  for (const rule of agent.routingRules) {
    const key = `routing:${rule.id}`
    nodes.push({
      id: key,
      type: 'routingRule',
      data: {
        label: routingRuleLabel(rule),
        sourceId: rule.id,
        meta: {
          priority: rule.priority,
          channels: rule.channels,
        },
      },
      position: { x: 0, y: 0 },
    })
    filterKeys.push(key)
  }

  // Triggers → every filter (Phase 1: every trigger flows through every filter)
  for (const tk of triggerKeys) {
    for (const fk of filterKeys) {
      edges.push({
        id: nextEdgeId(),
        source: tk,
        target: fk,
        type: 'default',
      })
    }
  }

  // ── Tool nodes + gate markers ──────────────────────────────────────────
  const toolNodeKeys: string[] = []
  const failureEndpointsUsed = new Set<string>()

  for (const toolName of Array.from(enabledNames).sort()) {
    const catalog = catalogByName.get(toolName)
    if (!catalog) continue // skip tools we don't have catalog metadata for

    const resolved = resolvedTools.get(toolName)
    if (resolved && !resolved.enabled) continue

    const toolKey = `tool:${toolName}`
    nodes.push({
      id: toolKey,
      type: 'tool',
      data: {
        label: toolLabel(toolName),
        meta: {
          toolName,
          onFailure: resolved?.onFailure ?? 'default',
        },
      },
      position: { x: 0, y: 0 },
    })
    toolNodeKeys.push(toolKey)

    // B3 gate marker for enforced tools (catalog enforcement === 'enforced')
    if (catalog.enforcement === 'enforced') {
      const gateKey = `gate:${toolName}`
      nodes.push({
        id: gateKey,
        type: 'gate',
        data: {
          label: 'Gate',
          meta: { toolName },
        },
        position: { x: 0, y: 0 },
      })

      // Re-route filter edges: filter → gate → tool (gated edge style)
      // For Phase 1, we wire every filter to the gate; if there are no
      // filters (rare — agent with no routing rules and no working hours)
      // we connect triggers directly.
      const upstream = filterKeys.length > 0 ? filterKeys : triggerKeys
      for (const uk of upstream) {
        edges.push({
          id: nextEdgeId(),
          source: uk,
          target: gateKey,
          type: 'gated',
        })
      }
      edges.push({
        id: nextEdgeId(),
        source: gateKey,
        target: toolKey,
        type: 'gated',
      })
    } else {
      // Direct wire-up: filter → tool (or trigger → tool if no filters)
      const upstream = filterKeys.length > 0 ? filterKeys : triggerKeys
      for (const uk of upstream) {
        edges.push({
          id: nextEdgeId(),
          source: uk,
          target: toolKey,
          type: 'default',
        })
      }
    }

    // onFailure → endpoint edge
    const mode = resolved?.onFailure ?? 'default'
    const endpoint = ON_FAILURE_LABELS[mode]
    if (endpoint) {
      failureEndpointsUsed.add(mode)
      edges.push({
        id: nextEdgeId(),
        source: toolKey,
        target: endpoint.key,
        type: 'onFailure',
        label: 'on failure',
      })
    }
  }

  // ── Failure endpoints (one per distinct non-default onFailure) ─────────
  for (const mode of failureEndpointsUsed) {
    const endpoint = ON_FAILURE_LABELS[mode]
    if (!endpoint) continue
    nodes.push({
      id: endpoint.key,
      type: 'failureEndpoint',
      data: {
        label: endpoint.label,
        meta: { mode },
      },
      position: { x: 0, y: 0 },
    })
  }

  // ── Stop condition nodes + pause endpoint ──────────────────────────────
  let pauseEmitted = false
  for (const sc of agent.stopConditions) {
    const key = `stop:${sc.id}`
    nodes.push({
      id: key,
      type: 'stopCondition',
      data: {
        label: stopConditionLabel(sc),
        sourceId: sc.id,
        meta: {
          conditionType: sc.conditionType,
          pauseAgent: sc.pauseAgent,
        },
      },
      position: { x: 0, y: 0 },
    })

    // stop conditions sit downstream of any tool — every tool → every stop
    // (Phase 1 simplification; later we may scope per-tool)
    for (const tk of toolNodeKeys) {
      edges.push({
        id: nextEdgeId(),
        source: tk,
        target: key,
        type: 'default',
      })
    }

    if (sc.pauseAgent && !pauseEmitted) {
      nodes.push({
        id: 'pause',
        type: 'pauseEndpoint',
        data: { label: 'Pause agent' },
        position: { x: 0, y: 0 },
      })
      pauseEmitted = true
    }
    if (sc.pauseAgent) {
      edges.push({
        id: nextEdgeId(),
        source: key,
        target: 'pause',
        type: 'default',
      })
    }
  }

  // ── Handover endpoint (when transfer_to_human is referenced anywhere) ──
  // Phase 1: surface a single handover node when fallbackBehavior includes
  // transfer, OR any tool resolves to transfer_to_human onFailure.
  const fb = agent.fallbackBehavior
  const fallbackTransfers = fb === 'transfer' || fb === 'message_and_transfer'
  const anyTransferTool = Array.from(resolvedTools.values())
    .some(c => c.onFailure === 'transfer_to_human' && enabledNames.has(c.toolName))
  if (fallbackTransfers || anyTransferTool) {
    nodes.push({
      id: 'handover',
      type: 'handoverEndpoint',
      data: { label: 'Hand over to human' },
      position: { x: 0, y: 0 },
    })
    if (fallbackTransfers) {
      // From every tool — fallback is when the agent can't resolve a turn
      for (const tk of toolNodeKeys) {
        edges.push({
          id: nextEdgeId(),
          source: tk,
          target: 'handover',
          type: 'onFailure',
          label: 'fallback',
        })
      }
    }
  }

  // ── Follow-up sequences (auxiliary, hang off tool nodes) ───────────────
  for (const fs of agent.followUpSequences) {
    const key = `followup:${fs.id}`
    const trigLabel = fs.triggerType === 'no_reply'
      ? `Follow-up: no reply ${fs.triggerValue ?? ''}h`
      : `Follow-up: ${fs.name}`
    nodes.push({
      id: key,
      type: 'followUp',
      data: {
        label: trigLabel,
        sourceId: fs.id,
        meta: {
          triggerType: fs.triggerType,
          triggerValue: fs.triggerValue,
        },
      },
      position: { x: 0, y: 0 },
    })

    // Follow-up sits downstream of tools that send replies
    const replyTools = toolNodeKeys.filter(k => k.endsWith(':send_reply') || k.endsWith(':send_sms') || k.endsWith(':send_email'))
    const upstream = replyTools.length > 0 ? replyTools : toolNodeKeys
    for (const tk of upstream) {
      edges.push({
        id: nextEdgeId(),
        source: tk,
        target: key,
        type: 'default',
      })
    }
  }

  // ── Validation badges ──────────────────────────────────────────────────
  // We surface three signals as corner chips on the affected nodes:
  //   • broken upstream refs (calendar / workflow no longer exists) → red
  //   • enforced tool with empty useWhen (gate would always block)   → amber
  //   • routing rule with empty conditions (never matches)           → amber
  // The renderer picks the most severe badge per node (broken > warning).
  const nodeById = new Map<string, FlowNode>(nodes.map(n => [n.id, n]))
  const pushBadge = (nodeId: string, badge: { kind: 'broken' | 'warning'; text: string }) => {
    const node = nodeById.get(nodeId)
    if (!node) return
    if (!node.data.badges) node.data.badges = []
    node.data.badges.push(badge)
  }

  // 1) Broken upstream references — populated by the Phase A reference
  //    health checker. We translate (resourceType, resourceId) into the
  //    set of nodes that would call into that resource.
  const brokenRefs = await db.agentReferenceHealth.findMany({
    where: { agentId, status: 'broken' },
    select: { resourceType: true, resourceId: true },
  })

  for (const ref of brokenRefs) {
    if (ref.resourceType === 'calendar') {
      for (const toolName of CALENDAR_DEPENDENT_TOOLS) {
        const key = `tool:${toolName}`
        if (nodeById.has(key)) pushBadge(key, { kind: 'broken', text: 'Calendar broken' })
      }
    } else if (ref.resourceType === 'workflow') {
      for (const toolName of WORKFLOW_TOOLS) {
        const key = `tool:${toolName}`
        if (nodeById.has(key)) pushBadge(key, { kind: 'broken', text: 'Workflow broken' })
      }
      // Stop conditions that enroll/remove the broken workflow id.
      for (const sc of agent.stopConditions) {
        if (sc.enrollWorkflowId === ref.resourceId || sc.removeWorkflowId === ref.resourceId) {
          pushBadge(`stop:${sc.id}`, { kind: 'broken', text: 'Workflow broken' })
        }
      }
    }
  }

  // 2) Enforced tools with no useWhen — the B3 gate would always block.
  for (const [toolName, resolved] of resolvedTools) {
    if (!enabledNames.has(toolName)) continue
    const catalog = catalogByName.get(toolName)
    if (!catalog || catalog.enforcement !== 'enforced') continue
    if (resolved.useWhen.trim().length === 0) {
      pushBadge(`tool:${toolName}`, { kind: 'warning', text: 'No rule — gate will block' })
    }
  }

  // 3) Routing rules with no conditions — would never match anything.
  // A rule is unmatchable when there's no compound `conditions` clause
  // AND its legacy ruleType isn't ALL AND it carries no legacy value to
  // match against. The ALL rule type matches anything, so it's fine
  // even with no value.
  for (const rule of agent.routingRules) {
    const c = rule.conditions as { clauses?: unknown[] } | null
    const hasClauses = !!c && Array.isArray(c.clauses) && c.clauses.length > 0
    const hasLegacyPredicate = rule.ruleType === 'ALL' || (rule.value !== null && rule.value !== '')
    if (!hasClauses && !hasLegacyPredicate) {
      pushBadge(`routing:${rule.id}`, { kind: 'warning', text: 'No condition' })
    }
  }

  // ── Layout overrides + dagre ───────────────────────────────────────────
  const overrides = new Map<string, { x: number; y: number }>()
  for (const layout of agent.nodeLayouts) {
    overrides.set(layout.nodeKey, { x: layout.x, y: layout.y })
  }

  const positioned = autoLayout(nodes, edges, overrides)

  return {
    nodes: positioned,
    edges,
    viewMode: ((agent as any).viewMode ?? 'simple') as 'simple' | 'advanced',
  }
}
