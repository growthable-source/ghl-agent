import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction, roleHas } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'
// Claude calls can take a bit. 60s is well under Vercel's 5-minute hard
// cap and plenty for a single non-streaming response.
export const maxDuration = 60

const client = new Anthropic()

// Same model the production agent uses, so the reviewer reasons with
// the same "head" that wrote the replies. Diagnosing a behaviour is a
// lot less useful if the auditor is a noticeably different model.
const REVIEWER_MODEL = 'claude-sonnet-4-20250514'

/**
 * Meta-Claude review endpoint.
 *
 * The admin chats with a "reviewer" Claude about a specific (agent,
 * contact) conversation. The reviewer does two things per turn:
 *   1. Writes prose analysis.
 *   2. Optionally calls the `propose_improvement` tool — zero or more
 *      times — with a CONCRETE apply-able change (PR 1: prompt_addition
 *      only). Each tool call lands in the DB as a PlatformLearning row
 *      with status=proposed, waiting for admin approval.
 *
 * One review thread == one AgentReview row. The messages column is an
 * append-only JSON array of turns with optional suggestion metadata;
 * we pass the full history on every call so Claude keeps context across
 * follow-ups.
 */

interface ReviewSuggestion {
  learningId: string
  type: 'prompt_addition'
  scope: 'this_agent' | 'workspace' | 'all_agents'
  title: string
  content: string
  rationale: string | null
}

interface ReviewMessage {
  role: 'admin' | 'assistant'
  content: string
  at: string
  // Only present on assistant turns that produced suggestions. Denormalised
  // for fast render; the canonical record is PlatformLearning rows.
  suggestions?: ReviewSuggestion[]
}

interface Body {
  agentId?: string
  contactId?: string
  reviewId?: string | null
  message?: string
}

const REVIEWER_SYSTEM_PREAMBLE = `You are an experienced conversational-AI engineer auditing a production AI agent that talks to customers over SMS / email / chat in the user's CRM (GoHighLevel). An operator (the human chatting with you) has opened a specific conversation the agent had with one of their contacts and wants your help diagnosing what the agent did wrong — and what to change to prevent it happening again.

Ground rules:
1. Be direct. Don't cushion. Point to specific turns ("Turn 4, when the agent asked for the email a second time").
2. Distinguish prompt/rule issues from tool-failure issues from "the agent did exactly what the config told it to, the config is wrong." Name which.
3. When you have a CONCRETE, APPLY-ABLE recommendation, call the propose_improvement tool with it. Don't just describe the fix in prose — actually propose it. The operator will see your proposal as a reviewable card with Approve / Reject buttons.
4. You may propose multiple improvements in a single turn if you see multiple distinct fixes. Propose zero if the agent behaved correctly.
5. Keep prose short and focused. The structured proposals do the heavy lifting; the prose explains WHY.
6. If the agent's behaviour was actually fine and the operator's concern is misplaced, say so — and don't propose anything.

SCOPE GUIDANCE — this is important. Every proposal must pick a scope:
- "this_agent" (default): the fix is specific to THIS agent's business, tone, or config. Pick this unless you're confident the fix is universal.
- "workspace": the fix is something the operator likely wants applied to every agent they run in this workspace (e.g., their whole company's agents should never promise same-day delivery). Still bounded to one customer.
- "all_agents": reserved for truly universal conversational-AI hygiene — behaviours that would be correct regardless of industry, tone, or customer. Examples: "never ask for information the contact has already provided", "never claim a tool call was made when it wasn't", "never invent calendar availability". If you can imagine a single legitimate customer for whom the rule should NOT apply, it is NOT all_agents.

Default hard to "this_agent". Overuse of "all_agents" will make operators turn off the platform learnings feature entirely.

Format your prose as short paragraphs. Use bullet points sparingly. Do not greet, do not sign off.`

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_improvement',
  description: 'Propose a concrete, apply-able change based on the conversation you just reviewed. Only call this when you have a specific, testable recommendation — not for generic advice. May be called multiple times per turn.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: {
        type: 'string',
        enum: ['prompt_addition'],
        description: 'The kind of change. Currently only "prompt_addition" is supported — a sentence or short paragraph that gets appended to the agent\'s system prompt (or to the platform guidelines block, for wider scopes).',
      },
      scope: {
        type: 'string',
        enum: ['this_agent', 'workspace', 'all_agents'],
        description: 'Where this improvement should apply. See the system prompt\'s SCOPE GUIDANCE section. Default to "this_agent" unless you are confident the fix is workspace-wide or truly universal.',
      },
      title: {
        type: 'string',
        description: 'A short 3–7 word label for the approval queue. Example: "Stop asking for email twice".',
      },
      content: {
        type: 'string',
        description: 'The actual text that will be applied. Write it as if it were part of a system prompt — imperative, specific, no "I suggest" or "you should". For scope=this_agent this gets appended to the specific agent\'s prompt; for workspace and all_agents it lands in a shared "## Platform Guidelines" block injected at runtime into every applicable agent. Keep each under 400 characters.',
      },
      rationale: {
        type: 'string',
        description: 'One sentence citing the turn number where the problem occurred AND justifying the scope choice. Example: "Turn 6: agent re-asked for email after Turn 3 provided it. Scope=all_agents because this failure mode is domain-independent."',
      },
    },
    required: ['type', 'scope', 'title', 'content', 'rationale'],
  },
}

function buildAgentBriefing(agent: any, messages: Array<{ role: string; content: string; createdAt: Date }>): string {
  const parts: string[] = []

  parts.push(`# Agent under review`)
  parts.push(`Name: ${agent.name}`)
  parts.push(`Type: ${agent.agentType} (${agent.agentType === 'ADVANCED' ? 'has business glossary + opportunity context' : 'basic contact context only'})`)
  parts.push(`Persona: ${agent.agentPersonaName ?? '(none)'}, formality=${agent.formalityLevel}, response length=${agent.responseLength}, emojis=${agent.useEmojis}`)
  parts.push(`Fallback behaviour: ${agent.fallbackBehavior}${agent.fallbackMessage ? ` — "${agent.fallbackMessage}"` : ''}`)
  if (agent.businessContext) {
    parts.push(`\nBusiness context provided by operator:\n${agent.businessContext}`)
  }

  parts.push(`\n# System prompt`)
  parts.push(agent.systemPrompt || '(default assistant prompt)')

  if (agent.qualifyingQuestions?.length) {
    parts.push(`\n# Qualifying questions the agent should collect`)
    for (const q of agent.qualifyingQuestions) {
      parts.push(`- [${q.fieldKey}] ${q.question}`)
    }
  }

  if (agent.detectionRules?.length) {
    parts.push(`\n# Detection rules (IF contact says X, THEN do Y)`)
    for (const r of agent.detectionRules) {
      parts.push(`- ${r.name}: ${r.conditionDescription}`)
    }
  }

  if (agent.listeningRules?.length) {
    parts.push(`\n# Listening rules (capture mentions of these into contact memory)`)
    for (const r of agent.listeningRules) {
      parts.push(`- ${r.name}: ${r.description}`)
    }
  }

  parts.push(`\n# Full transcript (${messages.length} turns)`)
  parts.push(`Role "user" = the contact. Role "assistant" = the agent.`)
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    parts.push(`\n[Turn ${i + 1} · ${m.role} · ${m.createdAt.toISOString().slice(11, 19)}]`)
    parts.push(m.content)
  }

  return parts.join('\n')
}

function autoTitle(firstAdminMessage: string): string {
  const trimmed = firstAdminMessage.replace(/\s+/g, ' ').trim()
  return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 57) + '…'
}

// When replaying the review history back into Claude on subsequent turns,
// we flatten each assistant message to just its text — Claude only sees
// its own prior text, not the tool-use blocks, because we're not using
// the agentic tool loop here. Every turn is a single synchronous call.
function flattenForReplay(m: ReviewMessage): Anthropic.MessageParam {
  return {
    role: m.role === 'admin' ? 'user' : 'assistant',
    content: m.content,
  }
}

interface ProposedInput {
  type: string
  scope: 'this_agent' | 'workspace' | 'all_agents'
  title: string
  content: string
  rationale: string
}

const VALID_SCOPES = new Set(['this_agent', 'workspace', 'all_agents'])

export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // The chat endpoint writes — it creates PlatformLearning proposals
  // and AgentReview rows, and costs money per call. Viewer admins can
  // read past reviews via the page; they cannot start new chats.
  if (!roleHas(session.role, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Body
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const agentId = body.agentId?.trim()
  const contactId = body.contactId?.trim()
  const adminMessage = body.message?.trim()
  if (!agentId || !contactId || !adminMessage) {
    return NextResponse.json({ error: 'agentId, contactId, and message required' }, { status: 400 })
  }

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true, name: true, systemPrompt: true, agentType: true,
      businessContext: true, agentPersonaName: true, responseLength: true,
      formalityLevel: true, useEmojis: true, fallbackBehavior: true,
      fallbackMessage: true,
      // Needed to denormalise workspaceId onto any learnings we create.
      // Prefer the explicit Agent.workspaceId; fall back to the location's.
      workspaceId: true,
      location: { select: { workspaceId: true } },
      detectionRules: {
        where: { isActive: true },
        orderBy: { order: 'asc' },
        select: { name: true, conditionDescription: true },
      },
      listeningRules: {
        where: { isActive: true },
        orderBy: { order: 'asc' },
        select: { name: true, description: true },
      },
      qualifyingQuestions: {
        orderBy: { order: 'asc' },
        select: { question: true, fieldKey: true },
      },
    },
  })
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  const messages = await db.conversationMessage.findMany({
    where: { agentId, contactId },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: { role: true, content: true, createdAt: true },
  })
  if (messages.length === 0) {
    return NextResponse.json({ error: 'No messages found for this conversation' }, { status: 404 })
  }

  let review = body.reviewId
    ? await db.agentReview.findUnique({ where: { id: body.reviewId } })
    : null

  // Tenancy check: the client can send any reviewId, but the route must
  // only thread messages into a review that actually belongs to the
  // (agentId, contactId) pair in the same request. Without this, a stale
  // client-side reviewId would silently append messages about a DIFFERENT
  // conversation into an old thread. 400 loudly rather than quietly
  // starting a new thread — a mismatch here is always a client bug.
  if (review && (review.agentId !== agentId || review.contactId !== contactId)) {
    return NextResponse.json(
      { error: 'reviewId does not belong to this (agent, contact). Refresh and try again.' },
      { status: 400 },
    )
  }

  const prior: ReviewMessage[] = review && Array.isArray(review.messages)
    ? (review.messages as unknown as ReviewMessage[])
    : []

  const briefing = buildAgentBriefing(agent, messages)
  const systemPrompt = `${REVIEWER_SYSTEM_PREAMBLE}\n\n---\n\n${briefing}`

  const anthMessages: Anthropic.MessageParam[] = prior.map(flattenForReplay)
  anthMessages.push({ role: 'user', content: adminMessage })

  let replyText: string
  const proposedInputs: ProposedInput[] = []
  try {
    const response = await client.messages.create({
      model: REVIEWER_MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      tools: [PROPOSE_TOOL],
      // Let Claude decide whether to propose an improvement. Forcing
      // a tool call would make the reviewer overreach on "the agent
      // handled it fine" threads.
      tool_choice: { type: 'auto' },
      messages: anthMessages,
    })

    replyText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim()

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      if (block.name !== 'propose_improvement') continue
      const input = block.input as Record<string, unknown>
      // Defensive validation — Claude almost always respects the schema
      // but we're about to persist and eventually MUTATE an agent's
      // prompt, so we don't trust anything unverified.
      if (typeof input.type !== 'string' ||
          typeof input.title !== 'string' ||
          typeof input.content !== 'string' ||
          typeof input.rationale !== 'string') {
        continue
      }
      if (input.type !== 'prompt_addition') continue
      if (!input.title.trim() || !input.content.trim()) continue
      // Scope is new in PR 2. Fall back to this_agent if Claude omitted
      // it (shouldn't happen — it's required in the schema — but belt
      // and braces because the apply path treats the scopes very
      // differently).
      const rawScope = typeof input.scope === 'string' ? input.scope : 'this_agent'
      const scope = VALID_SCOPES.has(rawScope)
        ? (rawScope as 'this_agent' | 'workspace' | 'all_agents')
        : 'this_agent'
      proposedInputs.push({
        type: input.type,
        scope,
        title: input.title.trim().slice(0, 120),
        content: input.content.trim().slice(0, 4000),
        rationale: input.rationale.trim().slice(0, 1000),
      })
    }

    if (!replyText && proposedInputs.length === 0) {
      replyText = '(The reviewer returned no prose or proposals — try rephrasing your question.)'
    }
    if (!replyText && proposedInputs.length > 0) {
      // Claude sometimes skips prose entirely when it's confident about
      // the fix. Give the UI something readable to show above the cards.
      replyText = `I've proposed ${proposedInputs.length} improvement${proposedInputs.length === 1 ? '' : 's'} — see below.`
    }
  } catch (err: any) {
    const msg = err?.message ?? 'Reviewer call failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Create or update the review row FIRST so we have an id to anchor
  // the learning rows to.
  const now = new Date()
  const draftAssistantMessage: ReviewMessage = {
    role: 'assistant',
    content: replyText,
    at: new Date().toISOString(),
  }
  const draftThread: ReviewMessage[] = [
    ...prior,
    { role: 'admin', content: adminMessage, at: now.toISOString() },
    draftAssistantMessage,
  ]

  if (!review) {
    review = await db.agentReview.create({
      data: {
        agentId,
        contactId,
        conversationId: null,
        adminId: session.adminId,
        adminEmail: session.email,
        title: autoTitle(adminMessage),
        messages: draftThread as unknown as object,
      },
    })
  } else {
    review = await db.agentReview.update({
      where: { id: review.id },
      data: { messages: draftThread as unknown as object },
    })
  }

  // Persist each proposal as a PlatformLearning. We do this AFTER the
  // review row exists so the FK is valid, and we need the learning ids
  // to embed them back into the messages JSON.
  const agentWorkspaceId = agent.workspaceId ?? agent.location?.workspaceId ?? null
  const createdLearnings = await Promise.all(
    proposedInputs.map(p =>
      db.platformLearning.create({
        data: {
          sourceReviewId: review!.id,
          scope: p.scope,
          // For this_agent and workspace scopes we denormalise the
          // workspace so the runtime injector can filter by it without
          // joining through the agent row on every inbound. For
          // all_agents we leave workspaceId null — the injector treats
          // null as "matches every workspace."
          workspaceId: p.scope === 'all_agents' ? null : agentWorkspaceId,
          // scope=all_agents learnings aren't anchored to any one
          // agent; null keeps them orphaned from the agent lifecycle.
          agentId: p.scope === 'this_agent' ? agentId : null,
          type: p.type,
          title: p.title,
          content: p.content,
          rationale: p.rationale,
          status: 'proposed',
          proposedByEmail: session.email,
        },
        select: { id: true, title: true, content: true, rationale: true, type: true, scope: true },
      }),
    ),
  )

  // Now embed the learning ids into the assistant message's
  // `suggestions` field so the UI can render approve/reject cards
  // without a second round-trip.
  if (createdLearnings.length > 0) {
    draftAssistantMessage.suggestions = createdLearnings.map(l => ({
      learningId: l.id,
      type: l.type as 'prompt_addition',
      scope: l.scope as 'this_agent' | 'workspace' | 'all_agents',
      title: l.title,
      content: l.content,
      rationale: l.rationale,
    }))
    review = await db.agentReview.update({
      where: { id: review.id },
      data: { messages: draftThread as unknown as object },
    })
  }

  logAdminAction({
    admin: session,
    action: 'conversation_review_turn',
    target: `${agentId}:${contactId}`,
    meta: {
      reviewId: review.id,
      turnCount: draftThread.length,
      proposedLearnings: createdLearnings.length,
    },
  }).catch(() => {})

  return NextResponse.json({
    reviewId: review.id,
    messages: draftThread,
  })
}
