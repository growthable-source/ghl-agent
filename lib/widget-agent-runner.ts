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
import { buildBasePrompt } from './agent/build-base-prompt'
import { findMatchingAgent } from './routing'
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
import { bridgeInboundVisitorMessage } from './slack/bridge'

/**
 * Pure decision: should the AI agent generate a reply on this turn?
 *
 * Exported so it can be unit-tested without standing up the whole
 * runner. The runner calls this immediately after resolving the
 * conversation state record — if it returns false, broadcast a
 * `agent_paused` event for transcript visibility and return.
 *
 * Reasons to NOT reply:
 *   - convoStatus is 'handed_off' (operator clicked "Jump in" in the
 *     inbox, or replied directly via the operator messages endpoint)
 *   - convoStatus is 'ended' (operator marked resolved)
 *   - state.state is 'PAUSED' (formal takeover via /api/.../takeover
 *     or a stop-condition fired)
 *
 * Active + null state = treat as eligible (state record gets created
 * lazily on the agent's first turn).
 */
export function shouldAgentReply(
  convoStatus: string,
  state: { state: string } | null,
): { reply: true } | { reply: false; reason: string } {
  if (convoStatus === 'handed_off' || convoStatus === 'ended') {
    return { reply: false, reason: convoStatus }
  }
  if (state?.state === 'PAUSED') {
    return { reply: false, reason: 'paused' }
  }
  return { reply: true }
}

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

  // Per-brand AI on/off gate. Some agencies prefer human-only support
  // for specific clients; turning aiEnabled=false on the brand makes
  // the widget operate as a pure inbox — visitor messages still come
  // through to operators, but no AI reply ever fires.
  //
  // Wrapped in try so missing-column (pre-migration) falls through to
  // the previous behaviour (AI enabled) instead of breaking widgets.
  try {
    if (widget.brandId) {
      const brand = await (db as any).brand.findUnique({
        where: { id: widget.brandId },
        select: { aiEnabled: true },
      })
      if (brand && brand.aiEnabled === false) {
        // No "agent_paused" broadcast — there's no agent here to pause.
        // The inbox still picks up the visitor message normally.
        return
      }
    }
  } catch (err: any) {
    if (err?.code !== 'P2022' && !/column .* does not exist/i.test(err?.message ?? '')) {
      throw err
    }
  }

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
    await broadcast(convo.id, {
      type: 'agent_error',
      message: 'No agent is configured to handle this widget. Add a default agent in the widget settings.',
    })
    return
  }

  // ─── Slack bridge ───────────────────────────────────────────────
  // Mirror the visitor message into Slack (opening the thread lazily on
  // the first message) BEFORE the human-takeover gate, so that once a
  // human is replying from Slack — which marks the conversation
  // handed_off — subsequent visitor messages still reach the thread. In
  // slack_only mode we suppress the AI for this turn entirely. Never let
  // a Slack hiccup break the agent path.
  const slackBridge = await bridgeInboundVisitorMessage({
    convo: {
      id: convo.id,
      workspaceId: widget.workspaceId,
      slackThreadTs: convo.slackThreadTs ?? null,
      visitorName: convo.visitor?.name ?? null,
      pageUrl: convo.pageUrl ?? null,
    },
    agent: { slackBridgeMode: agent.slackBridgeMode, slackChannelId: agent.slackChannelId },
    content,
  }).catch((e: any) => {
    console.warn('[slack] bridge inbound failed:', e?.message)
    return { suppressAi: false }
  })
  if (slackBridge.suppressAi) {
    // slack_only: a human in Slack is the agent; the AI never runs.
    return
  }

  // ─── Human-takeover gate ────────────────────────────────────────
  // Two state machines can both put the agent on pause; the bug
  // operators kept hitting was that the runner only gated on one:
  //
  //   1. WidgetConversation.status === 'handed_off' | 'ended'
  //      Set when an operator clicks "Jump in" in the inbox or hits
  //      the resolve button. This is the canonical UI-visible state
  //      that drives the inbox's "Taken over" badge.
  //
  //   2. ConversationStateRecord.state === 'PAUSED'
  //      Set by /api/workspaces/[id]/takeover (formal takeover) and
  //      by stop-conditions firing. Per-agent-per-contact, separate
  //      from the widget conversation row.
  //
  // Either should silence the AI. We resolve both BEFORE the typing
  // broadcast so the widget never shows a typing indicator that
  // never resolves.
  const widgetLocationId = `widget:${convo.widgetId}`
  const widgetContactId = `visitor:${convo.visitorId}`
  const state = await getOrCreateConversationState(agent.id, widgetLocationId, widgetContactId, convo.id).catch(() => null)

  const decision = shouldAgentReply(convo.status, state)
  if (!decision.reply) {
    await broadcast(convo.id, {
      type: 'agent_paused',
      reason: decision.reason === 'paused' ? (state?.pauseReason || 'paused') : decision.reason,
    })
    return
  }

  await broadcast(convo.id, { type: 'agent_typing', isTyping: true })

  const baseSystemPrompt = await buildBasePrompt(agent, {
    channel: 'widget',
    incomingMessage: content,
    visitorContactId: `visitor:${convo.visitorId}`,
    includeObjectives: true,
  })

  // Multilingual directive — ALWAYS reply in the visitor's language.
  // Claude's native multilingual ability handles detection and
  // generation; we just need to tell it to. The operator's English
  // translation is handled separately (lib/widget-translation.ts
  // post-processes each persisted message).
  const fullPrompt = baseSystemPrompt + `

## LANGUAGE
Detect the language of the visitor's most recent message and respond in THAT language. If they wrote in Spanish, reply in Spanish. French → French. Portuguese → Portuguese. Japanese → Japanese. Match the visitor's language for every turn, even if your knowledge base or system prompt is in English. Use the same level of formality their language suggests (tú vs usted, tu vs vous, etc.).

If the visitor switches languages mid-conversation, switch with them.

Never apologise for the language or mention translation — just speak naturally in their language. Names, brand terms, and product codes stay as written.`

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
      // Surface the row's createdAt so runAgent can render relative-time
      // tags ("[2 days ago]") on the historical messages it shows Claude.
      createdAt: m.createdAt.toISOString(),
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

  // HARD vocabulary enforcement — the prompt block alone demonstrably
  // fails when knowledge passages contain a banned term verbatim (the
  // agent quoted "HighLevel" straight out of crawled docs on a
  // whitelabel widget). Every visitor-visible string the agent loop
  // produces flows through adapter.sendMessage, so wrapping it here
  // guarantees rules WITH a replacement can never leak, no matter what
  // the model generated.
  try {
    const { parseVocabularyRules, applyVocabularyRules } = await import('./agent/vocabulary')
    const vocabRules = parseVocabularyRules((agent as any).vocabularyRules, agent.neverSayList)
    if (vocabRules.some(r => r.sayInstead)) {
      const origSend = adapter.sendMessage.bind(adapter)
      ;(adapter as any).sendMessage = (args: any) => origSend(
        args && typeof args.message === 'string'
          ? { ...args, message: applyVocabularyRules(args.message, vocabRules) }
          : args,
      )
    }
  } catch (err: any) {
    console.warn('[widget] vocabulary enforcement setup failed:', err?.message)
  }

  // state + widgetLocationId / widgetContactId already resolved above
  // for the pause-gate. Just bump the message counter here.
  await incrementMessageCount(agent.id, widgetContactId).catch(() => null)

  let result: Awaited<ReturnType<typeof runAgent>> | null = null
  try {
    result = await runAgent({
      locationId: widgetLocationId,
      agentId: agent.id,
      model: (agent as any).model,
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

    // Refresh the visitor's long-term memory summary. The cookie-based
    // visitorId already links return visits; this is the layer that
    // condenses prior chats into a paragraph the agent reads on the
    // NEXT visit (via runAgent's ContactMemory lookup). Fire-and-forget
    // so a slow Haiku call doesn't block the reply path. We only run
    // this every Nth message to avoid a Haiku call per turn.
    try {
      const { updateWidgetMemorySummary } = await import('./conversation-memory')
      const totalForVisitor = await db.widgetMessage.count({
        where: { conversation: { visitorId: convo.visitorId } },
      })
      // Refresh on every 4th message — frequent enough that long
      // conversations stay summarised, infrequent enough that we don't
      // burn a Haiku call on every reply.
      if (totalForVisitor >= 4 && totalForVisitor % 4 === 0) {
        updateWidgetMemorySummary({
          agentId: agent.id,
          workspaceId: widget.workspaceId,
          visitorId: convo.visitorId,
        }).catch(() => {})
      }
    } catch (err: any) {
      console.warn('[widget] memory summary refresh failed:', err?.message)
    }

    // Topic telemetry — record which knowledge domains/topics this
    // visitor question matched, for the portal Overview's "Top topics"
    // panel. Fire-and-forget, off the reply path: re-runs retrieval and
    // persists matched domains; failures are swallowed inside the helper.
    try {
      const { captureConversationTopics } = await import('./agent/capture-topics')
      captureConversationTopics({
        agent: { workspaceId: widget.workspaceId, knowledgeDomainIds: (agent as any).knowledgeDomainIds },
        conversationId: convo.id,
        widgetId: convo.widgetId,
        message: content,
      }).catch(() => {})
    } catch { /* dynamic import failed — skip telemetry */ }
  } finally {
    await broadcast(convo.id, { type: 'agent_typing', isTyping: false }).catch(() => {})
  }
}
