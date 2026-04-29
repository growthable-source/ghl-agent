/**
 * Shared runner for "the visitor sent something — wake the agent up."
 *
 * Used by both the text-message endpoint and the file-upload endpoint so
 * the agent reliably reacts to *every* visitor input regardless of how
 * the message arrived. Image attachments thread through to runAgent as
 * multimodal content blocks (Claude vision).
 */

import { db } from './db'
import { runAgent, type AgentAttachment } from './ai-agent'
import { findMatchingAgent } from './routing'
import { buildKnowledgeBlock } from './rag'
import { buildObjectivesBlockForAgent } from './agent-objectives'
import {
  getOrCreateConversationState,
  checkStopConditions,
  executeStopConditionActions,
  pauseConversation,
  incrementMessageCount,
} from './conversation-state'
import { notify } from './notifications'
import { resolveHandoverLink } from './handover-link'
import { broadcast } from './widget-sse'
import { WidgetAdapter } from './widget-adapter'

export interface RunWidgetAgentParams {
  /**
   * The WidgetConversation row (with widget + visitor included). The
   * caller already loaded this — we don't requery here to keep the hot
   * path tight.
   */
  convo: any
  /** What the visitor said. For uploads this is a brief breadcrumb like "(visitor sent an image)". */
  content: string
  /** Optional attachments — images thread through to runAgent as image blocks; files breadcrumb. */
  attachments?: AgentAttachment[]
}

export async function runWidgetAgent(params: RunWidgetAgentParams) {
  const { convo, content } = params
  const widget = convo.widget

  // Resolve the agent: defaultAgentId on the widget, else findMatchingAgent.
  let agent: any = null
  if (widget.defaultAgentId) {
    agent = await db.agent.findFirst({
      where: { id: widget.defaultAgentId, workspaceId: widget.workspaceId, isActive: true },
      include: {
        routingRules: true, stopConditions: true,
        followUpSequences: true, qualifyingQuestions: true, channelDeployments: true,
      },
    })
    if (agent) {
      // Hydrate workspace-stacked knowledge via the junction. We don't
      // include this in the Prisma `include` because the relation type
      // returns AgentKnowledge wrappers; the prompt builder wants the
      // entries directly. Same pattern as findMatchingAgent.
      const { bulkLoadKnowledgeForAgents } = await import('./knowledge')
      const map = await bulkLoadKnowledgeForAgents([agent.id])
      agent.knowledgeEntries = map.get(agent.id) ?? []
    }
  }
  if (!agent) {
    const loc = await db.location.findFirst({
      where: { workspaceId: widget.workspaceId },
      select: { id: true },
    })
    if (loc) {
      agent = await findMatchingAgent(loc.id, `visitor:${convo.visitorId}`, content, 'Live_Chat')
    }
  }

  if (!agent) {
    broadcast(convo.id, {
      type: 'agent_error',
      message: 'No agent is configured to handle this widget. Add a default agent in the widget settings.',
    })
    return
  }

  broadcast(convo.id, { type: 'agent_typing', isTyping: true })

  let fullPrompt = agent.systemPrompt
  fullPrompt += await buildObjectivesBlockForAgent(agent.id, content)
  if (agent.instructions) fullPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
  fullPrompt += buildKnowledgeBlock(agent.knowledgeEntries, content)

  if (agent.calendarId && agent.enabledTools.some((t: string) => ['get_available_slots', 'book_appointment'].includes(t))) {
    fullPrompt += `\n\n## Calendar Configuration
Calendar ID for booking: ${agent.calendarId}
Contact ID for this conversation: visitor:${convo.visitorId}

Note: This conversation is happening on a website chat widget. When booking, use the visitor's email (ask for it if not provided — it's required for the calendar invite).`
  }

  // Quick-reply convention — tell the agent how to offer choice chips.
  // The widget renderer strips the marker and exposes the options as
  // clickable buttons.
  fullPrompt += `\n\n## Quick replies (web widget only)
When you want to offer the visitor 2–4 quick choices to click, end your
message with: <quickReplies>Option A|Option B|Option C</quickReplies>
The system strips the marker and renders each pipe-separated value as a
button. Use sparingly — for clear branching ("Yes / Not yet", "Pricing /
Booking / Other"). Don't use it for free-text answers.`

  // Build recent history. Image / file messages flow through as
  // attachmentKind so runAgent can rebuild multimodal turns.
  const recent = await db.widgetMessage.findMany({
    where: { conversationId: convo.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  const history = recent.reverse().slice(0, -1).map(m => {
    let attachmentKind: 'image' | 'file' | undefined
    let attachmentUrl: string | undefined
    let attachmentName: string | undefined
    if (m.kind === 'image') {
      attachmentKind = 'image'
      attachmentUrl = m.content
    } else if (m.kind === 'file') {
      try {
        const meta = JSON.parse(m.content) as { url: string; name: string }
        attachmentKind = 'file'
        attachmentUrl = meta.url
        attachmentName = meta.name
      } catch {}
    }
    return {
      id: m.id,
      conversationId: convo.id,
      locationId: `widget:${convo.widgetId}`,
      contactId: `visitor:${convo.visitorId}`,
      body: attachmentKind ? '' : m.content,
      direction: m.role === 'visitor' ? ('inbound' as const) : ('outbound' as const),
      attachmentKind,
      attachmentUrl,
      attachmentName,
    }
  })

  // Real CRM adapter (calendar/opportunity tools) when the workspace has
  // one connected, otherwise null and those tools degrade cleanly.
  let inner: import('./crm/types').CrmAdapter | null = null
  try {
    const realLocation = await db.location.findFirst({
      where: { workspaceId: widget.workspaceId, crmProvider: { not: 'none' } },
      select: { id: true },
      orderBy: { installedAt: 'desc' },
    })
    if (realLocation) {
      const { getCrmAdapter } = await import('./crm/factory')
      inner = await getCrmAdapter(realLocation.id)
    }
  } catch (err: any) {
    console.warn('[widget] could not resolve CRM adapter — calendar tools will degrade:', err?.message)
  }

  const adapter = new WidgetAdapter({
    widgetId: convo.widgetId,
    conversationId: convo.id,
    inner,
  })

  const widgetLocationId = `widget:${convo.widgetId}`
  const widgetContactId = `visitor:${convo.visitorId}`
  await getOrCreateConversationState(agent.id, widgetLocationId, widgetContactId, convo.id).catch(() => null)
  await incrementMessageCount(agent.id, widgetContactId).catch(() => null)

  let result: Awaited<ReturnType<typeof runAgent>> | null = null
  try {
    result = await runAgent({
      locationId: widgetLocationId,
      agentId: agent.id,
      contactId: widgetContactId,
      conversationId: convo.id,
      channel: 'Live_Chat',
      incomingMessage: content,
      incomingAttachments: params.attachments,
      messageHistory: history,
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
      adapter,
    } as any)

    if (!result?.reply || !result.reply.trim()) {
      const fallbackMessage = "I hit a snag on my end — let me get someone on our team to follow up."
      try {
        await adapter.sendMessage({
          type: 'Live_Chat',
          contactId: widgetContactId,
          message: fallbackMessage,
        })
      } catch (err: any) {
        console.warn('[widget] silent-agent fallback failed:', err?.message)
      }
      if (convo.widget.workspaceId) {
        try {
          await notify({
            workspaceId: convo.widget.workspaceId,
            event: 'agent_error',
            title: `Agent went silent on ${convo.widget.name || 'a widget'}`,
            body: `The agent processed an inbound but produced no reply. Visitor: "${content.slice(0, 120)}". Sent fallback message instead.`,
            link: resolveHandoverLink({
              workspaceId: convo.widget.workspaceId,
              locationId: `widget:${convo.widgetId}`,
              conversationId: convo.id,
              channel: 'Live_Chat',
            }),
            severity: 'warning',
          })
        } catch {}
      }
    }

    try {
      const stopCheck = await checkStopConditions(
        agent,
        widgetContactId,
        content,
        result?.actionsPerformed ?? [],
      )
      if (stopCheck.matched && !agent.locationId.startsWith('widget:')) {
        await executeStopConditionActions({
          matched: stopCheck.matched,
          locationId: agent.locationId,
          contactId: widgetContactId,
          reason: stopCheck.reason ?? 'condition_met',
        }).catch(() => {})
      }
      if (stopCheck.shouldPause) {
        await pauseConversation(agent.id, widgetContactId, stopCheck.reason ?? 'condition_met')
      }
    } catch (err: any) {
      console.warn('[widget] stop-condition check failed:', err?.message)
    }
  } finally {
    broadcast(convo.id, { type: 'agent_typing', isTyping: false })
  }
}
