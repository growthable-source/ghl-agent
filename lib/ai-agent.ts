/**
 * AI Agent — the conversational runtime.
 *
 * This file is the runner: pulls together the runtime context blocks,
 * drives the agentic tool loop against Anthropic's Messages API, and
 * returns an AgentResponse. The pure pieces live alongside in
 * lib/agent/*:
 *
 *   - lib/agent/tool-catalog.ts  → AGENT_TOOLS, constrainWorkflowTool
 *   - lib/agent/sandbox.ts       → executeSandboxTool (playground stubs)
 *   - lib/agent/execute-tool.ts  → executeTool (CRM dispatcher)
 *   - lib/agent/build-prompt.ts  → buildSystemPrompt
 *   - lib/agent/types.ts         → AgentResponse, AgentAttachment, …
 *
 * Public surface for the rest of the codebase: `runAgent`, plus the
 * AgentResponse / AgentAttachment types re-exported below.
 */

import Anthropic from '@anthropic-ai/sdk'
import { getCrmAdapter } from './crm/factory'
import type { CrmAdapter } from './crm/types'
import { applyTypos, calculateTypingDelay, type PersonaSettings } from './persona'
import { detectFalseActionClaim, safeFallbackReply, fallbackForFailedTool } from './action-claim-detector'
import { loadPlatformGuidelinesBlock } from './platform-learning'
import type { AgentContext, Message } from '@/types'

import { AGENT_TOOLS, constrainWorkflowTool } from './agent/tool-catalog'
import { REQUIRED_TOOL_KEYS } from './agent-tools-catalog'
import { executeTool } from './agent/execute-tool'
import { buildSystemPrompt } from './agent/build-prompt'
import type {
  AgentAttachment,
  AgentResponse,
  DeferredSendCapture,
  FallbackConfig,
  HandoverCapture,
  ToolCallEntry,
} from './agent/types'

// Re-export the public surface so existing callers keep working unchanged.
export type { AgentAttachment, AgentResponse } from './agent/types'

const client = new Anthropic()

/**
 * Render a compact "known customer" block to append to the commerce
 * system prompt. Kept short — the agent has lookup_shopify_customer
 * for drill-down. Goal here is "the model should never need to ask
 * who they are if we already know."
 */
function renderShopifyCustomerBlock(c: {
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  numberOfOrders: number
  lifetimeSpend: { amount: string; currency: string } | null
  tags: string[]
  recentOrders: Array<{
    name: string
    processedAt: string | null
    total: { amount: string; currency: string }
    fulfillmentStatus: string | null
    lineItems: Array<{ title: string; quantity: number }>
  }>
}): string {
  const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'unknown name'
  const ltv = c.lifetimeSpend ? `${c.lifetimeSpend.amount} ${c.lifetimeSpend.currency}` : 'unknown'
  const tags = c.tags.length > 0 ? c.tags.join(', ') : 'none'

  const lastOrders = c.recentOrders.slice(0, 3).map(o => {
    const when = o.processedAt ? new Date(o.processedAt).toISOString().slice(0, 10) : '?'
    const items = o.lineItems
      .slice(0, 3)
      .map(li => `${li.quantity}× ${li.title}`)
      .join(', ')
    const more = o.lineItems.length > 3 ? `, +${o.lineItems.length - 3} more` : ''
    const status = o.fulfillmentStatus || 'unknown status'
    return `  - ${o.name} (${when}, ${o.total.amount} ${o.total.currency}, ${status}): ${items}${more}`
  }).join('\n')

  return `\n\n### Known Shopify customer\nName: ${name}\nEmail: ${c.email ?? '—'}\nPhone: ${c.phone ?? '—'}\nLifetime: ${c.numberOfOrders} orders, ${ltv} total\nTags: ${tags}${lastOrders ? `\nRecent orders:\n${lastOrders}` : ''}\n\nUse this naturally — don't recite the data back at the customer. It's context so your replies feel "this brand knows me," not a tool dump.`
}

export async function runAgent(opts: {
  locationId: string
  agentId?: string
  /**
   * Logical model key for this agent (lib/llm registry): 'auto' (default →
   * DEFAULT_AGENT_MODEL), 'claude-sonnet', 'deepseek-flash', etc. Callers
   * that have the agent row pass `agent.model`; everyone else defaults to
   * 'auto'. The llm layer escalates to Claude for vision / MCP / failure.
   */
  model?: string
  contactId: string
  conversationId?: string
  conversationProviderId?: string
  channel?: string
  incomingMessage: string
  /**
   * Attachments accompanying the incoming message — sent as image content
   * blocks alongside the text so Claude can actually see them.
   */
  incomingAttachments?: AgentAttachment[]
  messageHistory?: Message[]
  systemPrompt?: string
  enabledTools?: string[]
  persona?: PersonaSettings
  fallback?: FallbackConfig
  qualifyingStyle?: 'strict' | 'natural'
  sandbox?: boolean
  // Optional injected CRM adapter — used by the widget runtime to route
  // sendMessage through SSE instead of GHL/HubSpot. When provided, this
  // overrides the default adapter lookup for the given locationId.
  adapter?: CrmAdapter
  /**
   * When true, the agent's outbound reply is CAPTURED rather than sent.
   * Used by the approval-queue flow: we let the agent generate its reply,
   * then let the caller decide whether to release or queue for human review.
   * Returns `deferredCapture` on the response when anything was captured.
   */
  deferSend?: boolean
  /**
   * Which published workflows the agent is allowed to enroll contacts in / remove
   * contacts from. When provided, the matching tool's `workflowId` property is
   * rewritten to an `enum` of the pinned IDs so the agent physically can't
   * pick an arbitrary (hallucinated) workflow. Empty/missing arrays drop the
   * corresponding tool from the published set.
   *
   * Names are included alongside IDs so we can enrich the tool description
   * with a human-readable list — e.g. "id_abc — Lead Nurture" — without
   * forcing a live GHL round-trip on every agent invocation.
   */
  workflowPicks?: {
    addTo?: Array<{ id: string; name: string }>
    removeFrom?: Array<{ id: string; name: string }>
  }
}): Promise<AgentResponse> {
  const { locationId, agentId, model: agentModelKey, contactId, conversationId, conversationProviderId, channel = 'SMS', incomingMessage, messageHistory, systemPrompt, enabledTools, persona, fallback, qualifyingStyle, sandbox, adapter, deferSend, workflowPicks } = opts
  const isSandbox = sandbox || contactId.startsWith('playground-')

  // Resolve CRM adapter: explicit override > sandbox-null > default lookup
  const crm = adapter ?? (isSandbox ? null : await getCrmAdapter(locationId))

  // Capture slot for deferred sends (approval queue)
  const deferredSend: DeferredSendCapture | undefined = deferSend ? { captured: null } : undefined

  // Capture slot for transfer_to_human — fires a `human_handover`
  // notification after the tool loop completes.
  const handoverCapture: HandoverCapture = { captured: null }

  // Load the contact once up front. Used for merge-field rendering in
  // qualifying questions + fallback message + anywhere else that
  // personalises pre-written text. Previously the system prompt's
  // "Current Conversation Context" block read ctx.contact but nothing
  // ever populated it — contacts appeared as "unknown" every time.
  // Widget visitors and failed lookups land as null and fallback syntax
  // ({{contact.first_name|there}}) picks up the slack.
  let loadedContact: any = null
  if (!isSandbox && crm) {
    try { loadedContact = await crm.getContact(contactId) } catch { /* ignore */ }
  }

  // Build message history for Claude
  const messages: Anthropic.MessageParam[] = []

  // Build a single user message — multimodal when attachments are present,
  // plain string otherwise. Image attachments piggy-back as image blocks
  // so Claude (Sonnet 4 / Opus) can actually see them.
  function buildUserContent(text: string, attachments?: AgentAttachment[]): string | Anthropic.ContentBlockParam[] {
    const imgs = (attachments || []).filter(a => a.kind === 'image' && a.url)
    const fileBreadcrumbs = (attachments || [])
      .filter(a => a.kind === 'file' && a.url)
      .map(a => `[Attached file: ${a.name || a.url}]`)
      .join('\n')
    const textWithBreadcrumbs = fileBreadcrumbs ? `${text}\n${fileBreadcrumbs}` : text
    if (imgs.length === 0) return textWithBreadcrumbs
    const blocks: Anthropic.ContentBlockParam[] = []
    for (const img of imgs) {
      blocks.push({
        type: 'image',
        source: { type: 'url', url: img.url },
      } as any)
    }
    blocks.push({ type: 'text', text: textWithBreadcrumbs })
    return blocks
  }

  // Pure helpers for booking heuristics + relative-age formatting live
  // in ./agent-heuristics so they can be unit-tested in isolation.
  const { formatRelativeAge } = await import('./agent-heuristics')
  const nowMs = Date.now()

  // Include recent message history as context
  if (messageHistory && messageHistory.length > 0) {
    const recent = messageHistory.slice(-8) // last 8 messages
    for (const msg of recent) {
      // Skip if it's the same as the incoming message
      if (msg.body === incomingMessage && msg.direction === 'inbound') continue
      const role = msg.direction === 'inbound' ? 'user' : 'assistant'
      // Prepend a relative-time tag so the agent can tell whether prior
      // turns are 5 minutes old or 5 days old. Without this every turn
      // looks equally fresh and the agent re-asks questions or repeats
      // promises that are stale.
      const ageTag = formatRelativeAge(msg.createdAt, nowMs)
      const tagPrefix = ageTag ? ageTag + ' ' : ''
      // Reconstruct multimodal content for past inbound messages that
      // had image attachments, so the model has the visual context.
      if (role === 'user' && msg.attachmentKind === 'image' && msg.attachmentUrl) {
        messages.push({
          role,
          content: buildUserContent(`${tagPrefix}${msg.body || '(image)'}`, [{
            kind: 'image',
            url: msg.attachmentUrl,
            name: msg.attachmentName,
          }]),
        })
      } else if (role === 'user' && msg.attachmentKind === 'file' && msg.attachmentUrl) {
        messages.push({
          role,
          content: `${tagPrefix}${msg.body || ''}\n[Attached file: ${msg.attachmentName || msg.attachmentUrl}]`.trim(),
        })
      } else {
        messages.push({ role, content: `${tagPrefix}${msg.body}` })
      }
    }
  }

  // Add the current incoming message — multimodal when attachments came
  // through with this turn (e.g. visitor just uploaded an image).
  messages.push({
    role: 'user',
    content: buildUserContent(
      `[Inbound ${channel} message from contact ${contactId}]: ${incomingMessage}`,
      opts.incomingAttachments,
    ),
  })

  const actionsPerformed: string[] = []
  const toolCallTrace: ToolCallEntry[] = []
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let smsSent: string | null = null

  // Load qualifying questions for this agent
  // In sandbox: show all questions (no answer state to check)
  // In production: only show unanswered required questions
  let qualifyingBlock = ''
  if (agentId) {
    // Merge context for rendering {{contact.first_name|there}} etc. in
    // question text. Persona provides agent.name; timezone comes from
    // the caller's persona opt if set. Resolve the assigned user + hydrate
    // custom field keys so {{user.*}} and {{custom.*}} both render.
    const { resolveAssignedUser, hydrateContactCustomFields } = await import('./merge-fields')
    const { GhlAdapter } = await import('./crm/ghl/adapter')
    let assignedUser: Awaited<ReturnType<typeof resolveAssignedUser>> = null
    let hydratedContact = loadedContact
    try {
      const locId = (loadedContact as any)?.locationId
      if (locId) {
        const adapter = new GhlAdapter(locId)
        const [u, c] = await Promise.all([
          resolveAssignedUser(adapter, loadedContact),
          hydrateContactCustomFields(adapter, loadedContact),
        ])
        assignedUser = u
        hydratedContact = (c as typeof loadedContact) ?? loadedContact
      }
    } catch { /* non-fatal */ }
    const mergeCtx = {
      contact: hydratedContact,
      agent: { name: persona?.agentPersonaName ?? null },
      user: assignedUser,
      timezone: null,
    }
    if (isSandbox) {
      const { getAllQuestions, buildQualifyingPromptBlock } = await import('./qualifying')
      const questions = await getAllQuestions(agentId)
      qualifyingBlock = buildQualifyingPromptBlock(questions, qualifyingStyle ?? 'strict', mergeCtx)
    } else {
      const { getUnansweredQuestions, buildQualifyingPromptBlock } = await import('./qualifying')
      const unanswered = await getUnansweredQuestions(agentId, contactId)
      qualifyingBlock = buildQualifyingPromptBlock(unanswered, qualifyingStyle ?? 'strict', mergeCtx)
    }
  }

  // Load detection rules — natural-language "if the contact says X, set
  // field Y to Z" rules that the agent evaluates against every inbound.
  // The block goes into the system prompt; the field→overwrite map lets
  // executeTool enforce keep-first-answer semantics on rule-governed fields.
  let detectionRulesBlock = ''
  let fieldOverwriteMap: Record<string, boolean> = {}
  // Tools the rules themselves require (add_to_workflow, update_contact_tags,
  // etc). Auto-enabled below so users don't have to toggle both the rule
  // AND the underlying tool.
  let ruleRequiredTools: string[] = []
  if (agentId) {
    const { getActiveDetectionRules, buildDetectionRulesBlock, buildFieldOverwriteMap, requiredToolsForRules } = await import('./detection-rules')
    const rules = await getActiveDetectionRules(agentId)
    detectionRulesBlock = buildDetectionRulesBlock(rules)
    fieldOverwriteMap = buildFieldOverwriteMap(rules)
    ruleRequiredTools = requiredToolsForRules(rules)
  }

  // Load listening rules — categories the agent watches for passively.
  // Also surface anything we already know about this contact (prior summary
  // + categorised memory entries) so the agent has continuity across turns.
  let listeningRulesBlock = ''
  let contactMemoryBlock = ''
  let advancedContextBlock = ''
  let hasListeningRules = false
  if (agentId) {
    const { getActiveListeningRules, buildListeningRulesBlock, buildContactMemoryBlock } = await import('./listening-rules')
    const listening = await getActiveListeningRules(agentId)
    listeningRulesBlock = buildListeningRulesBlock(listening)
    hasListeningRules = listening.length > 0

    // Pull existing memory for this contact (summary + categories).
    // Safe in sandbox — the table is keyed by (agentId, playground-contactId)
    // and stays isolated from real data. updatedAt is included so the
    // memory block can stamp the summary with how recently it was
    // captured ("as of 3 days ago"). Without that the agent treats a
    // months-old summary as if it's fresh.
    try {
      const memory = await (await import('./db')).db.contactMemory.findUnique({
        where: { agentId_contactId: { agentId, contactId } },
        select: { summary: true, categories: true, updatedAt: true },
      })
      if (memory) {
        contactMemoryBlock = buildContactMemoryBlock({
          summary: memory.summary,
          categories: memory.categories as Record<string, string> | null,
          summaryUpdatedAt: memory.updatedAt?.toISOString() ?? null,
        })
      }
    } catch {
      // Non-fatal — proceed without memory context.
    }

    // Advanced-agent context block — opt-in via agentType. Only fetches
    // opportunities + hydrates custom fields when the agent is configured
    // for advanced context; Simple agents pay zero overhead. Skipped in
    // sandbox (no real CRM) and on widget runs (no real contact id).
    // The block builder does its own hydration of contact + opportunity
    // custom fields, so we pass the raw loadedContact here.
    if (!isSandbox && crm) {
      try {
        const agentRow = await (await import('./db')).db.agent.findUnique({
          where: { id: agentId },
          select: { agentType: true, businessContext: true },
        })
        if ((agentRow as any)?.agentType === 'ADVANCED') {
          const { buildContactContextBlock } = await import('./agent-context-block')
          advancedContextBlock = await buildContactContextBlock({
            adapter: crm,
            contact: loadedContact,
            businessContext: (agentRow as any).businessContext ?? null,
          })
        }
      } catch (err: any) {
        // Non-fatal — agent proceeds without the advanced block.
        console.warn('[Agent] advanced context block failed:', err.message)
      }
    }
  }

  // Platform Guidelines block. Pulled from the PlatformLearning pipeline
  // — every applied scope=all_agents learning, plus scope=workspace
  // learnings for this agent's workspace, minus workspaces that opted
  // out. Cached for 2 minutes in platform-learning.ts so this lookup is
  // effectively free after the first inbound of a warm node.
  //
  // Resolve the workspace via the Agent row first (explicit link), then
  // fall back to the Location's workspace. Null is fine — the loader
  // still returns the global (scope=all_agents) block.
  // Resolve workspaceId once — reused for platform guidelines, data
  // sources, MCP, and any other workspace-scoped lookup below. Null is
  // valid (sandbox / no-agent path); downstream consumers handle it.
  // PARITY GUARDRAIL — workspaceId is resolved identically in sandbox and
  // production. Context-loading code below depends on it; if you skip
  // resolution in sandbox, the simulator stops mirroring prod and
  // operators silently lose the ability to test changes safely. Only
  // *side-effects* (writes, sends, billable calls) should branch on
  // isSandbox — never the prompt context.
  let workspaceId: string | null = null
  try {
    if (agentId) {
      const row = await (await import('./db')).db.agent.findUnique({
        where: { id: agentId },
        select: {
          workspaceId: true,
          location: { select: { workspaceId: true } },
        },
      })
      workspaceId = row?.workspaceId ?? row?.location?.workspaceId ?? null
    } else if (!locationId.startsWith('placeholder:') && !locationId.startsWith('widget:')) {
      const row = await (await import('./db')).db.location.findUnique({
        where: { id: locationId },
        select: { workspaceId: true },
      })
      workspaceId = row?.workspaceId ?? null
    }
  } catch (err: any) {
    console.warn('[Agent] workspaceId resolution failed:', err.message)
  }

  let platformGuidelinesBlock = ''
  try {
    platformGuidelinesBlock = await loadPlatformGuidelinesBlock(workspaceId)
  } catch (err: any) {
    // Non-fatal. Never block an inbound on a learnings lookup — the
    // agent is always at least as capable without the block as it was
    // before PR 2 shipped.
    console.warn('[Agent] platform guidelines load failed:', err.message)
  }

  // ─── Reference health gating ───────────────────────────────────────
  // Drop tools that depend on a broken reference (mode = 'tool_disable',
  // the workspace default), or skip the run entirely (mode = 'agent_pause').
  // 'warn_only' is a no-op — the runtime fallback shipped 2026-05-28
  // handles individual tool failures.
  const toolsToHide = new Set<string>()
  const brokenLabelsForPrompt: string[] = []
  if (!isSandbox && agentId) {
    try {
      const { db } = await import('./db')
      const broken = await db.agentReferenceHealth.findMany({
        where: { agentId, status: 'broken' },
        select: { resourceType: true, resourceId: true },
      })
      if (broken.length > 0 && workspaceId) {
        const ws = await db.workspace.findUnique({
          where: { id: workspaceId },
          select: { brokenReferenceMode: true },
        })
        const mode = (ws as any)?.brokenReferenceMode ?? 'tool_disable'

        if (mode === 'agent_pause') {
          console.log(`[Agent] ${agentId}: skipping run, ${broken.length} broken refs, mode=agent_pause`)
          return {
            reply: null,
            actionsPerformed: [],
            tokensUsed: 0,
            toolCallTrace: [],
            deferredCapture: undefined,
            skipped: 'broken_references' as const,
          } as any
        }

        if (mode === 'tool_disable') {
          const { VALIDATORS } = await import('@/lib/agent/reference-health/validators')
          for (const ref of broken) {
            const v = VALIDATORS[ref.resourceType]
            if (!v) continue
            for (const t of v.dependentTools) toolsToHide.add(t)
            brokenLabelsForPrompt.push(`${v.label} ${ref.resourceId}`)
          }
        }
      }
    } catch (err: any) {
      console.warn(`[Agent] reference health gating failed for ${agentId}:`, err?.message)
      // Fail-open: don't block the agent run on a transient DB hiccup. The
      // runtime fallback we shipped 2026-05-28 catches the underlying tool
      // failure if it actually happens.
    }
  }

  // ─── Per-tool config resolution (Phase B1) ─────────────────────────
  // Load merged per-tool config (DB overrides + catalog defaults). Used
  // for: (a) injecting the "Tool usage rules" section into the prompt,
  // (b) dispatching onFailure when a tool errors at runtime.
  let resolvedToolConfigs: Map<string, import('./agent/tool-config').ResolvedToolConfig> = new Map()
  let agentAutonomyMode: 'guided' | 'autonomous' = 'guided'
  if (!isSandbox && agentId) {
    try {
      const { resolveAgentToolConfig } = await import('./agent/tool-config')
      resolvedToolConfigs = await resolveAgentToolConfig(agentId)
      const { db } = await import('./db')
      const agentRow = await db.agent.findUnique({
        where: { id: agentId },
        select: { toolAutonomyMode: true } as any,
      })
      const mode = (agentRow as any)?.toolAutonomyMode
      agentAutonomyMode = mode === 'autonomous' ? 'autonomous' : 'guided'
    } catch (err: any) {
      console.warn(`[Agent] tool-config resolution failed for ${agentId}: ${err?.message}`)
      // Fail-open: empty Map means no overrides, runtime behaves as pre-B1.
    }
  }

  // Tools explicitly disabled via AgentToolConfig — drop from the model's
  // tool list. Composes with Phase A's tool-disable (toolsToHide).
  if (resolvedToolConfigs.size > 0) {
    for (const cfg of resolvedToolConfigs.values()) {
      if (!cfg.enabled) toolsToHide.add(cfg.toolName)
    }
  }

  // ─── Active experiments ───
  // Resolve any running A/B experiments for this agent. Variant resolution
  // (and the prompt block it produces) ALWAYS runs — sandbox sees the
  // same variant the production contactId would land in, so simulations
  // mirror prod. Only the side-effect — writing the "exposed" event into
  // AgentExperimentEvent — is gated on !isSandbox, so dry-run replays
  // don't pollute experiment metrics.
  let experimentBlock = ''
  try {
    if (agentId) {
      const { resolveExperimentVariants, buildExperimentBlock } = await import('./experiments')
      const variants = await resolveExperimentVariants(agentId, contactId, { writeExposures: !isSandbox })
      experimentBlock = buildExperimentBlock(variants)
    }
  } catch (err: any) {
    console.warn('[Agent] experiment resolution failed:', err.message)
  }

  // ─── Live data sources (Google Sheets / Airtable / saved REST) ───
  // Resolve every active WorkspaceDataSource for this workspace and
  // describe them in the system prompt so the model knows which `source`
  // names it can pass to lookup_sheet / query_airtable / fetch_data.
  // Loaded identically in sandbox and prod (parity). The data-source
  // tools themselves are read-only, so calling them in sandbox is safe
  // and matches what the agent would actually do live.
  let dataSourcesBlock = ''
  let dataSourcesList: Array<{ id: string; name: string; kind: string }> = []
  try {
    // Post-Collections: data sources are scoped per-agent through
    // attached collections. Only sources the operator wired into a
    // collection this agent uses surface here. Falls back to the
    // workspace-wide list if no collection is attached, so a fresh
    // agent in a workspace that has data sources but no collection
    // setup yet still sees the tools (matches legacy behavior).
    if (agentId) {
      const { listActiveDataSourcesForAgent, listActiveDataSources, describeDataSources } = await import('./data-sources')
      let sources = await listActiveDataSourcesForAgent(agentId)
      if (sources.length === 0 && workspaceId) {
        sources = await listActiveDataSources(workspaceId)
      }
      dataSourcesBlock = describeDataSources(sources)
      dataSourcesList = sources.map(s => ({ id: s.id, name: s.name, kind: s.kind }))
    } else if (workspaceId) {
      const { listActiveDataSources, describeDataSources } = await import('./data-sources')
      const sources = await listActiveDataSources(workspaceId)
      dataSourcesBlock = describeDataSources(sources)
      dataSourcesList = sources.map(s => ({ id: s.id, name: s.name, kind: s.kind }))
    }
  } catch (err: any) {
    console.warn('[Agent] data-source load failed:', err.message)
  }

  // ─── MCP attachments ───
  // Load every external MCP tool the user has wired into this agent.
  // Apply per-attachment keyword gates against the incoming message so we
  // only expose tools that are contextually relevant. The Anthropic
  // mcp_servers parameter actually executes the calls; the prompt block
  // is our steering layer (whenToUse rules).
  let mcpServersParam: ReturnType<typeof import('./mcp-runtime').buildMcpServersParam> = []
  let connectedIntegrationsBlock = ''
  try {
    const { loadAgentMcpAttachments, filterByKeywords, buildMcpServersParam, buildConnectedIntegrationsBlock } = await import('./mcp-runtime')
    const all = await loadAgentMcpAttachments(agentId)
    const live = filterByKeywords(all, incomingMessage)
    mcpServersParam = buildMcpServersParam(live)
    connectedIntegrationsBlock = buildConnectedIntegrationsBlock(live)
  } catch (err: any) {
    console.warn('[Agent] MCP attachment load failed:', err.message)
  }

  // ─── Commerce (Shopify) context ───
  // When the workspace has a Shopify store connected, inject a block
  // telling the agent it has live catalogue + customer + order data
  // available via the search_shopify_products / check_shopify_inventory /
  // lookup_shopify_customer / check_shopify_order_status tools, and to
  // NEVER guess product details. Hallucinated SKUs/prices/stock is the
  // failure mode this kills. Block is empty (no-op) when not connected.
  let commerceBlock = ''
  if (workspaceId) {
    try {
      const { getShopifyConnection } = await import('./commerce/shopify/token-store')
      const conn = await getShopifyConnection(workspaceId)
      if (conn) {
        commerceBlock = `\n\n## Commerce (Shopify) — connected: ${conn.shop}\n\nYou have LIVE access to this Shopify store's catalogue, inventory, customers, and orders. You MUST use the tools below before discussing any product or order detail. NEVER invent product names, prices, sizes, colours, stock levels, SKUs, tracking numbers, or order statuses.\n\nTools available:\n- \`search_shopify_products\` — call this first whenever a customer asks "do you have X?", "how much is Y?", "what sizes/colours?", "what's in stock?". Pass natural-language queries like "wool socks" or "blue hoodie size M".\n- \`check_shopify_inventory\` — after search_shopify_products, call this with a specific variantId for precise stock counts per fulfilment location.\n- \`lookup_shopify_customer\` — call this near the start of every conversation if you have the customer's email or phone, to personalise the reply with their past order history. If it returns found:false, treat them as a new customer — do NOT invent purchase history.\n- \`check_shopify_order_status\` — call this whenever a customer asks "where's my order?" or references an order number. Returns live fulfilment + tracking.\n- \`create_shopify_checkout\` — build a draft order with specific variants and get a one-tap checkout URL. Use when the customer is ready to buy: "I'll grab those — here's your checkout link." Always confirm the variants + quantities first.\n- \`create_shopify_discount\` — mint a real Shopify discount code on the fly for save-the-sale / loyalty / win-back. Keep the discount sensible (5-15% off, single-use, 24-72h expiry) unless the operator has explicitly authorised more.\n- \`record_back_in_stock_interest\` — when a customer asks about an OOS variant, save their interest with this and promise to DM them when it's back. The system handles the follow-up automatically. Only works on the widget channel for now; other channels return not_supported_on_channel — offer to take an email for manual follow-up in that case.\n\nIf a tool returns shopify_not_connected, tell the customer you can't access live store data right now and offer to escalate.\n\n### Rich product cards\nWhen you recommend a SPECIFIC product to the customer, append a marker like this to your send_reply message text — one marker per product, max 3 per reply:\n\n  <productCard>gid://shopify/Product/1234567890</productCard>\n\nThe customer never sees the marker — channels that support rich rendering (the chat widget) replace it with a tappable card showing image, title, price, and a "View Product" button. Channels that don't (SMS, voice) strip it silently. Use the \`id\` field from search_shopify_products verbatim. Only emit a marker for a product you actually intend the customer to look at next — listing 5 products is noise. Pick the best 1-3 and let the card do the showing.`

        // ─── Per-conversation Shopify customer hydration ───
        // If we already know the contact's email or phone (from GHL /
        // native CRM / widget pre-chat form / Meta sender mapping), pull
        // their Shopify profile BEFORE the agent runs and inject it into
        // the prompt. Differs from the `lookup_shopify_customer` tool —
        // the tool is reactive ("call this if you need it"), this is
        // proactive ("always know who you're talking to"). Saves a tool
        // round-trip per turn for repeat customers, and means even a
        // simple "hi" reply can reference their last order.
        const contactEmail = (loadedContact as { email?: string } | null)?.email
        const contactPhone = (loadedContact as { phone?: string } | null)?.phone
        if (contactEmail || contactPhone) {
          try {
            const { ShopifyAdapter } = await import('./commerce/shopify/adapter')
            const shopAdapter = new ShopifyAdapter({ shop: conn.shop, accessToken: conn.accessToken })
            const customer = await shopAdapter.findCustomer({ email: contactEmail, phone: contactPhone })
            if (customer) {
              commerceBlock += renderShopifyCustomerBlock(customer)
            }
          } catch (err: any) {
            console.warn('[Agent] Shopify customer hydration failed:', err?.message)
          }
        }
      }
    } catch (err: any) {
      console.warn('[Agent] Shopify connection lookup failed:', err.message)
    }
  }

  // ─── Conversation gap awareness ───
  // If the last message in this conversation is more than an hour old,
  // tell the agent how long it's been so it can resume gracefully (skip
  // the re-introduction, acknowledge the gap if it's been a while, drop
  // any time-bound promises that have expired). Without this signal the
  // agent treats every turn as if it follows immediately from the last —
  // which is why operators see "as I mentioned earlier today" 5 days
  // after the prior message.
  let conversationGapBlock = ''
  if (messageHistory && messageHistory.length > 0) {
    const lastWithTime = [...messageHistory].reverse().find(m => m.createdAt && m.body !== incomingMessage)
    if (lastWithTime?.createdAt) {
      const lastMs = new Date(lastWithTime.createdAt).getTime()
      if (Number.isFinite(lastMs) && lastMs > 0) {
        const gapMs = Math.max(0, nowMs - lastMs)
        const ONE_HOUR = 60 * 60 * 1000
        if (gapMs >= ONE_HOUR) {
          const ageTag = formatRelativeAge(lastWithTime.createdAt, nowMs).replace(/^\[|\]$/g, '')
          conversationGapBlock = `\n\n## Conversation Resumed\nThe contact's previous activity in this conversation was ${ageTag}. This is NOT a fresh first contact — pick up where you left off:\n- Do not re-introduce yourself or repeat the welcome line.\n- Do not re-ask qualifying questions you already have answers to in the history above.\n- If you made a time-bound promise earlier (e.g. "I'll follow up next week") and that window has passed or shifted, acknowledge the gap rather than pretending the promise is still pending.\n- Historical messages above carry relative-age tags like "[3 days ago]" — use those to judge whether prior context is still relevant.`
        }
      }
    }
  }

  // Filter tools based on agent configuration
  // Normalize: ensure dependent tool pairs are always enabled together.
  //  - send_sms → send_reply (legacy back-compat)
  //  - get_available_slots ↔ book_appointment (so the agent can always
  //    actually commit a booking after reading slots)
  //  - book_appointment → get_available_slots (same reason, the other way)
  //  - book_appointment → create_appointment_note (so agent can log context)
  const normalizedTools = enabledTools
    ? [...new Set([
        ...enabledTools,
        // Always include the required tools (send_reply,
        // transfer_to_human). If an old agent's enabledTools array
        // doesn't include send_reply (it predates the field becoming
        // required), Claude ends up with no reply tool and falls
        // back to emitting raw `<invoke name="send_reply">` XML in
        // the chat content. Force-including required keys closes
        // that hole.
        ...REQUIRED_TOOL_KEYS,
        ...(enabledTools.includes('send_sms') ? ['send_reply'] : []),
        ...(enabledTools.includes('get_available_slots') ? ['book_appointment'] : []),
        ...(enabledTools.includes('book_appointment')
          ? ['get_available_slots', 'create_appointment_note', 'cancel_appointment', 'reschedule_appointment', 'get_calendar_events']
          : []),
        // Detection rules pull in whichever tools their actions need
        // (update_contact_field / update_contact_tags / add_to_workflow /
        // etc). Auto-enabled so authoring a rule is consent for its tool —
        // users don't have to toggle both.
        ...ruleRequiredTools,
        // Same for listening rules → update_contact_memory.
        ...(hasListeningRules ? ['update_contact_memory'] : []),
      ])]
    : undefined
  const filteredTools = (normalizedTools ? AGENT_TOOLS.filter(t => normalizedTools.includes(t.name)) : AGENT_TOOLS)
    .filter(t => !toolsToHide.has(t.name))

  // ─── Tool usage rules block (Phase B1) ──────────────────────────
  // Inject per-tool "use when" rules — only in guided mode. The agent
  // gets one line per ENABLED tool that's still in its tool list (post
  // Phase A reference-health filter + Phase B1 enabled flag).
  let toolRulesBlock = ''
  if (agentAutonomyMode === 'guided' && resolvedToolConfigs.size > 0) {
    const enabledToolNames = new Set<string>(
      (Array.isArray(filteredTools) ? filteredTools : []).map((t: any) => t?.name).filter(Boolean),
    )
    const rules: string[] = []
    for (const cfg of resolvedToolConfigs.values()) {
      if (!enabledToolNames.has(cfg.toolName)) continue
      if (!cfg.useWhen) continue
      rules.push(`- ${cfg.toolName}: ${cfg.useWhen}`)
    }
    if (rules.length > 0) {
      toolRulesBlock = `\n\n## Tool usage rules\n\nYou have the following tools available. Use each ONLY when its rule applies. If a contact's message doesn't match any tool's rule, respond conversationally without calling a tool.\n\n${rules.join('\n')}`
    }
  }

  // ─── Workflow-picker enforcement ───
  // When the user has pinned specific workflows in the UI, rewrite the tool
  // schema so the agent can only pick from that whitelist. If nothing is
  // pinned for a given tool, drop the tool entirely — publishing it with no
  // valid target just invites hallucinated workflowIds that 404 against GHL.
  //
  // We also strip Voxility-internal metadata (defaultUseWhen,
  // defaultOnFailure, enforcement) from each entry before passing to the
  // Anthropic API. Those fields live on AgentToolDef for the resolver +
  // gate to consume — Anthropic's tool-definition shape only accepts
  // { name, description, input_schema } and rejects anything else with
  // `invalid_request_error: Extra inputs are not permitted`. Caused
  // production 400s after the Phase B1 catalog additions shipped.
  function toAnthropicTool(t: any) {
    return {
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
      ...(t.cache_control ? { cache_control: t.cache_control } : {}),
    }
  }
  const tools = filteredTools.flatMap(t => {
    if (t.name === 'add_to_workflow') {
      return constrainWorkflowTool(t, workflowPicks?.addTo, 'enroll').map(toAnthropicTool)
    }
    if (t.name === 'remove_from_workflow') {
      return constrainWorkflowTool(t, workflowPicks?.removeFrom, 'remove').map(toAnthropicTool)
    }
    return [toAnthropicTool(t)]
  })

  // Agentic loop — keeps going until Claude stops calling tools
  let currentMessages = [...messages]
  const MAX_ITERATIONS = 6
  const availableToolNames = tools.map(t => t.name)
  let hallucinationRetries = 0
  const MAX_HALLUCINATION_RETRIES = 2
  let forceToolNextIteration: string | null = null

  // ─── Decide initial tool_choice ───
  // If the inbound message strongly signals intent to book (and the booking
  // tools are available), force Claude to call A tool on the first turn.
  // This breaks the "let me check and get back to you" non-action reply.
  const heuristics = await import('./agent-heuristics')
  const hasBookingTools = availableToolNames.includes('get_available_slots') || availableToolNames.includes('book_appointment')
  const initialForceAny = heuristics.hasBookingIntent(incomingMessage) && hasBookingTools

  if (initialForceAny) {
    console.log(`[Agent] Booking intent detected in "${incomingMessage?.slice(0, 60)}" — forcing tool_choice: any`)
  }

  // ─── Detect confirmation-after-offer ───
  // The going-in-circles bug: agent proposes a time, contact says "yes",
  // agent re-calls get_available_slots and offers DIFFERENT times. To
  // break the loop we force tool_choice = book_appointment whenever:
  //   (a) the contact's reply looks like a confirmation, AND
  //   (b) the previous outbound from the agent looks like it offered a
  //       specific time slot.
  // Both heuristics are conservative and unit-tested in agent-heuristics.
  const lastOutboundBody = messageHistory && messageHistory.length > 0
    ? [...messageHistory].reverse().find(m => m.direction === 'outbound' && m.body)?.body ?? null
    : null
  const isBookingConfirmation =
    heuristics.isShortAffirmation(incomingMessage)
    && heuristics.looksLikeOfferedTime(lastOutboundBody)
    && availableToolNames.includes('book_appointment')

  if (isBookingConfirmation) {
    console.log(`[Agent] Confirmation "${incomingMessage?.slice(0, 30)}" after offered slots — forcing book_appointment`)
  }

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // Compute tool_choice for THIS iteration
    let toolChoice: { type: string; name?: string } | undefined
    if (forceToolNextIteration) {
      toolChoice = { type: 'tool', name: forceToolNextIteration }
      console.log(`[Agent] Forcing specific tool: ${forceToolNextIteration}`)
      forceToolNextIteration = null
    } else if (i === 0 && isBookingConfirmation) {
      // Confirmation pin: must call book_appointment, not just "any" tool.
      // Otherwise the agent picks get_available_slots again and circles.
      toolChoice = { type: 'tool', name: 'book_appointment' }
    } else if (i === 0 && initialForceAny) {
      toolChoice = { type: 'any' }
    }

    const createParams: any = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: buildSystemPrompt(
        { locationId, contactId, contact: loadedContact ?? undefined } as AgentContext,
        {
          customPrompt: systemPrompt,
          persona,
          channel,
          fallback,
          qualifyingBlock,
          detectionRulesBlock,
          listeningRulesBlock,
          contactMemoryBlock,
          advancedContextBlock,
          platformGuidelinesBlock,
          connectedIntegrationsBlock,
          commerceBlock,
        },
      ) + experimentBlock + dataSourcesBlock + conversationGapBlock + (brokenLabelsForPrompt.length > 0
        ? `\n\nIMPORTANT: The following CRM resources are temporarily unavailable due to a configuration issue: ${brokenLabelsForPrompt.join(', ')}. The associated tools (booking, workflow enrolment, etc.) have been removed from your tool list for this conversation. If the contact asks about scheduling, workflow actions, or anything that requires these resources, acknowledge their request and tell them a teammate will follow up shortly. Do not pretend to attempt these actions.`
        : '') + toolRulesBlock,
      tools,
      messages: currentMessages,
    }
    if (toolChoice) createParams.tool_choice = toolChoice
    if (mcpServersParam.length > 0) createParams.mcp_servers = mcpServersParam

    let response: Awaited<ReturnType<typeof client.messages.create>>
    try {
      // Provider-agnostic call: routes to the agent's selected model
      // (Claude / DeepSeek), escalating to Claude for vision / MCP /
      // failure. Returns the Anthropic-shaped message this loop reads.
      const { createMessage: llmCreateMessage } = await import('./llm')
      response = await llmCreateMessage(agentModelKey ?? 'auto', createParams, { surface: 'agent', workspaceId, agentId }) as unknown as Anthropic.Messages.Message
    } catch (err: any) {
      // Anthropic was unreachable/overloaded after retries. Do NOT
      // crash the webhook with a 500 (silent to the visitor) — return
      // a structured "skipped" result so the channel handler can leave
      // the message unanswered for the next inbound or a human, rather
      // than dropping it into a void. The conversation stays intact.
      console.error(`[Agent] Anthropic call failed after retries (status ${err?.status ?? 'network'}):`, err?.message)
      return {
        reply: null,
        actionsPerformed,
        tokensUsed: totalInputTokens + totalOutputTokens,
        toolCallTrace,
        skipped: 'model_unavailable',
      } as AgentResponse
    }

    // Log MCP tool calls (executed by Anthropic's backend, not our loop)
    try {
      const { extractMcpActions } = await import('./mcp-runtime')
      for (const a of extractMcpActions(response.content as any[])) {
        actionsPerformed.push(a)
      }
    } catch {}

    totalInputTokens += response.usage.input_tokens
    totalOutputTokens += response.usage.output_tokens

    // Process response content
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use')
    const textBlocks = response.content.filter(b => b.type === 'text')

    if (response.stop_reason === 'end_turn' || toolUseBlocks.length === 0) {
      // Done — extract any final text
      const finalText = textBlocks.map(b => (b as Anthropic.TextBlock).text).join('\n')

      // ─── Hallucination guardrail ───
      // Detect replies that CLAIM an action happened when the matching tool
      // was never called. Force the model to either call the tool or correct.
      const falseClaim = finalText
        ? detectFalseActionClaim(finalText, actionsPerformed, availableToolNames)
        : null
      if (falseClaim && hallucinationRetries < MAX_HALLUCINATION_RETRIES) {
        hallucinationRetries++
        console.warn(`[Agent] ⚠ Hallucination detected (retry ${hallucinationRetries}/${MAX_HALLUCINATION_RETRIES}):`,
          `claimed ${falseClaim.tool} without calling it. Reply: "${falseClaim.phrase}"`)
        // Force the specific tool on the next iteration — this physically
        // prevents Claude from ending the turn without calling it.
        if (falseClaim.tool && availableToolNames.includes(falseClaim.tool)) {
          forceToolNextIteration = falseClaim.tool
        }
        // Push the model's claim + a corrective user turn, then continue looping
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: falseClaim.correction },
        ]
        continue
      }
      if (falseClaim && hallucinationRetries >= MAX_HALLUCINATION_RETRIES) {
        // Out of retries — replace the lying reply with a safe fallback so we
        // don't send a fabricated confirmation to the contact.
        console.error(`[Agent] ❌ Hallucination persists after ${MAX_HALLUCINATION_RETRIES} retries. Replacing false claim.`)
        actionsPerformed.push(`hallucination_blocked:${falseClaim.tool}`)
        const fallbackText = safeFallbackReply(falseClaim)
        if (!smsSent) {
          if (deferredSend) {
            deferredSend.captured = {
              channel: channel || 'SMS',
              contactId,
              message: fallbackText,
              conversationProviderId,
            }
            smsSent = fallbackText
            actionsPerformed.push(`send_reply (fallback, ${channel}, deferred)`)
          } else if (crm) {
            await crm.sendMessage({
              type: (channel || 'SMS') as import('@/types').MessageChannelType,
              contactId,
              conversationProviderId,
              message: fallbackText,
            })
            smsSent = fallbackText
            actionsPerformed.push(`send_reply (fallback, ${channel})`)
          }
        }
        break
      }

      if (finalText && !smsSent) {
        // Claude wrote a reply but didn't use send_reply. Auto-send via
        // whichever output path we have; sandbox has no adapter but we
        // still populate smsSent so the reply surfaces in the
        // playground / simulator UI (runAgent returns `reply: smsSent`).
        let msgToSend = finalText
        if (persona?.simulateTypos) msgToSend = applyTypos(msgToSend)
        if (persona?.typingDelayEnabled) {
          const delay = calculateTypingDelay(msgToSend, persona.typingDelayMinMs, persona.typingDelayMaxMs)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        if (deferredSend) {
          // Deferred: capture instead of sending
          deferredSend.captured = {
            channel: channel || 'SMS',
            contactId,
            message: msgToSend,
            conversationProviderId,
          }
          smsSent = msgToSend
          actionsPerformed.push(`send_reply (auto, ${channel}, deferred)`)
        } else if (crm) {
          await crm.sendMessage({
            type: (channel || 'SMS') as import('@/types').MessageChannelType,
            contactId,
            conversationProviderId,
            message: msgToSend,
          })
          smsSent = msgToSend
          actionsPerformed.push(`send_reply (auto, ${channel})`)
        } else if (isSandbox) {
          // Sandbox / playground / simulator: no CRM to send through,
          // but the reply still has to appear in the UI. Populating
          // smsSent is enough — the runAgent caller renders it as the
          // agent's visible reply. Marking the action lets the tool-
          // trace show how the reply got here.
          smsSent = msgToSend
          actionsPerformed.push(`send_reply (auto, ${channel}, sandbox)`)
        }
      } else if (!finalText && !smsSent) {
        // Loop exited with neither text nor a send_reply call — usually
        // Claude called a tool and stopped expecting to be prompted
        // again. Log loudly so future debugging in production doesn't
        // have to come back to this file cold.
        console.warn('[Agent] loop exited with no reply and no final text.', {
          agentId, contactId, iteration: i, stopReason: response.stop_reason,
          lastToolsCalled: toolCallTrace.slice(-3).map(t => t.tool),
        })

        // Identify any tool error this run. The 404-from-calendar
        // pattern Ryan reported produces a tool result with
        // success:false; we use that to drive both the graceful
        // fallback reply (so the contact isn't ghosted) and the
        // operator notification.
        const failedTools = toolCallTrace.filter(t => {
          try {
            const parsed = JSON.parse(t.output)
            return parsed?.success === false || parsed?.error
          } catch { return false }
        })
        const lastFailed = failedTools[failedTools.length - 1]
        const hadToolError = failedTools.length > 0

        // ─── Graceful contact-facing fallback ───────────────────────
        // The model gave up — but the human on the other end is still
        // waiting. Send a tool-aware fallback message synchronously
        // so the contact hears something acknowledging their request
        // and knows a teammate will follow up. The operator gets
        // emailed in parallel (below) and takes over from the deep
        // link. Without this branch, the contact stares at a blank
        // inbox until the operator manually intervenes — exactly the
        // "stopped replying silently" behaviour Ryan flagged.
        if (hadToolError && (crm || deferredSend || isSandbox)) {
          const fallbackText = fallbackForFailedTool(lastFailed?.tool)
          try {
            if (deferredSend) {
              deferredSend.captured = {
                channel: channel || 'SMS',
                contactId,
                message: fallbackText,
                conversationProviderId,
              }
              smsSent = fallbackText
              actionsPerformed.push(`send_reply (tool_error_fallback, deferred)`)
            } else if (crm) {
              await crm.sendMessage({
                type: (channel || 'SMS') as import('@/types').MessageChannelType,
                contactId,
                conversationProviderId,
                message: fallbackText,
              })
              smsSent = fallbackText
              actionsPerformed.push(`send_reply (tool_error_fallback, ${channel})`)
            } else if (isSandbox) {
              smsSent = fallbackText
              actionsPerformed.push(`send_reply (tool_error_fallback, sandbox)`)
            }
          } catch (err: any) {
            console.warn('[Agent] tool-error fallback send failed:', err?.message)
          }
        }

        // ─── Operator notify + pause future turns ───────────────────
        // Pause stops the agent from looping on the same broken tool
        // for the next inbound while the operator investigates.
        // Sandbox runs skip both — no real conversation to pause.
        if (!isSandbox && agentId && workspaceId) {
          // Fire-and-forget — don't let notification failure mask the
          // already-broken run from getting logged above.
          ;(async () => {
            try {
              const { notify } = await import('./notifications')
              const { resolveHandoverLink } = await import('./handover-link')
              const link = resolveHandoverLink({
                workspaceId, locationId, contactId,
                conversationId: conversationId ?? null,
                channel: channel ?? null,
              })
              const body = hadToolError && lastFailed
                ? `${lastFailed.tool} returned an error. A graceful fallback message was sent to the contact and the conversation is paused — open it to take over and resolve the underlying tool issue.`
                : `The agent processed an inbound but produced no reply (stop_reason=${response.stop_reason}). Open the conversation to take over.`
              await notify({
                workspaceId,
                event: 'agent_error',
                title: hadToolError
                  ? 'Agent fell back to manual handoff — tool failure'
                  : 'Agent stopped responding — take over conversation',
                body,
                link,
                severity: 'error',
              })
              if (hadToolError) {
                const { pauseConversation } = await import('./conversation-state')
                await pauseConversation(
                  agentId,
                  contactId,
                  `tool_error_silent_exit:${lastFailed?.tool ?? 'unknown'}`,
                )
              }
            } catch (err: any) {
              console.warn('[Agent] silent-exit notify failed:', err?.message)
            }
          })()
        }
      }
      break
    }

    // Execute all tool calls
    const toolResults: Anthropic.ToolResultBlockParam[] = []
    for (const block of toolUseBlocks) {
      const toolBlock = block as Anthropic.ToolUseBlock
      actionsPerformed.push(toolBlock.name)
      const toolStart = Date.now()

      // SINGLE-SEND GUARD — refuse a second outbound message in the same
      // run. Without this, a chatty model can emit multiple send_reply
      // blocks (across iterations OR within one response) and each one
      // delivers an SMS to the contact, producing the "flood of apologies"
      // pattern. Post-reply housekeeping tools (tags, notes, opportunity
      // moves) still run normally; only additional sends are blocked.
      const isSendTool = toolBlock.name === 'send_reply' || toolBlock.name === 'send_sms'
      if (isSendTool && smsSent !== null) {
        const blockedResult = JSON.stringify({
          success: false,
          error: 'duplicate_send_blocked',
          alreadySent: smsSent.slice(0, 200),
          hint: 'You have already sent one reply this turn. Wait for the contact to respond before sending again. End your turn now — do NOT call send_reply or send_sms again.',
        })
        toolCallTrace.push({
          tool: toolBlock.name,
          input: toolBlock.input as Record<string, unknown>,
          output: blockedResult,
          durationMs: Date.now() - toolStart,
        })
        actionsPerformed.push(`${toolBlock.name}_blocked_duplicate`)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolBlock.id,
          content: blockedResult,
        })
        continue
      }

      const result = await executeTool(
        toolBlock.name,
        toolBlock.input as Record<string, unknown>,
        locationId,
        isSandbox,
        agentId,
        channel,
        conversationProviderId,
        crm ?? undefined,
        deferredSend,
        fieldOverwriteMap,
        handoverCapture,
        workspaceId,
        contactId,
        conversationId,
        // Conversation history for the enforced-tool gate (Phase B3).
        // The gate inspects up to 10 most-recent turns to decide whether
        // the useWhen rule is satisfied. Strip non-text content to keep
        // the gate prompt small + relevant.
        (messageHistory ?? [])
          .filter(m => (m.direction === 'inbound' || m.direction === 'outbound') && typeof m.body === 'string')
          .map(m => ({
            role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.body,
          })),
      )
      toolCallTrace.push({
        tool: toolBlock.name,
        input: toolBlock.input as Record<string, unknown>,
        output: result,
        durationMs: Date.now() - toolStart,
      })

      // Track message sends (send_reply or legacy send_sms)
      if (isSendTool) {
        const parsed = JSON.parse(result)
        if (parsed.success) {
          let msg = (toolBlock.input as { message: string }).message
          if (persona?.simulateTypos) msg = applyTypos(msg)
          smsSent = msg
        }
      }

      // Persist booking-context across turns. When get_available_slots
      // returns slots we record them so the next turn's prompt builder
      // can surface the exact ISO timestamps — preventing the model from
      // re-fetching after a "yes" and offering different times. When
      // book_appointment succeeds we mark the cached offer as consumed.
      if (!isSandbox && agentId && conversationId) {
        if (toolBlock.name === 'get_available_slots') {
          try {
            const parsed = JSON.parse(result)
            if (parsed?.success && Array.isArray(parsed.slots)) {
              const { recordOfferedSlots } = await import('./conversation-memory')
              await recordOfferedSlots({
                agentId, locationId, contactId, conversationId,
                slots: parsed.slots,
                timezone: parsed.timezone ?? null,
              })
            }
          } catch { /* non-fatal */ }
        } else if (toolBlock.name === 'book_appointment') {
          try {
            const parsed = JSON.parse(result)
            if (parsed?.success) {
              const { clearOfferedSlots } = await import('./conversation-memory')
              await clearOfferedSlots({ agentId, locationId, contactId, conversationId })
            }
          } catch { /* non-fatal */ }
        }
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolBlock.id,
        content: result,
      })
    }

    // Continue the loop with the tool results
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ]
  }

  // ── Human-handover notification ──────────────────────────────────────
  // When the agent called transfer_to_human we notify everyone who's
  // subscribed to the `human_handover` event on this workspace. Fire and
  // forget — a notification failure must never break the agent reply.
  if (!isSandbox && handoverCapture.captured && agentId) {
    ;(async () => {
      try {
        const { db: prisma } = await import('./db')
        const agentRow = await prisma.agent.findUnique({
          where: { id: agentId }, select: { workspaceId: true, name: true },
        })
        if (!agentRow?.workspaceId) return

        const { notify } = await import('./notifications')
        const { resolveHandoverLink } = await import('./handover-link')
        const link = resolveHandoverLink({
          workspaceId: agentRow.workspaceId,
          locationId, contactId, conversationId, channel,
        })

        const cap = handoverCapture.captured
        if (!cap) return
        await notify({
          workspaceId: agentRow.workspaceId,
          event: 'human_handover',
          title: `${agentRow.name || 'Agent'} needs a human on ${channel}`,
          body: [
            cap.reason ? `Reason: ${cap.reason}` : null,
            cap.contextSummary ? `Context: ${cap.contextSummary}` : null,
          ].filter(Boolean).join('\n'),
          link,
          severity: 'warning',
        })

        // Widget chat handover → the customer explicitly asked for a
        // human (this is the transfer_to_human path), so FORCE-assign:
        // normal routing first, but if that picks nobody (manual mode or
        // everyone away) fall back to the widget's fallback owner / the
        // workspace owner. The chat is never left ownerless. Other
        // channels (SMS / web phone) don't have an inbox queue concept yet.
        if (channel === 'Live_Chat' && conversationId) {
          try {
            const { forceAssignToHuman } = await import('./widget-routing')
            await forceAssignToHuman({ workspaceId: agentRow.workspaceId, conversationId })
          } catch (err: any) {
            console.warn('[Handover] force-assign failed:', err?.message)
          }
        }
      } catch (err: any) {
        console.warn('[Handover] notify failed:', err?.message)
      }
    })()
  }

  return {
    reply: smsSent,
    actionsPerformed,
    tokensUsed: totalInputTokens + totalOutputTokens,
    toolCallTrace,
    deferredCapture: deferredSend?.captured ?? undefined,
  }
}
