import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'

/**
 * Headless meta-Claude review for a completed Simulation.
 *
 * Mirrors the human-driven /api/admin/conversation-review/chat route but
 * runs unattended — no admin types anything, Claude just analyses the
 * simulated transcript and proposes PlatformLearnings (status=proposed)
 * that land in the /admin/learnings queue.
 *
 * Every Simulation gets exactly one auto-review. The resulting
 * AgentReview row is linked back on Simulation.reviewId so the UI can
 * drill in. Individual proposals are normal PlatformLearning rows with
 * sourceReviewId pointing at that review — they look identical to
 * human-triggered proposals, they just showed up without a human asking.
 */

const client = new Anthropic()
const REVIEWER_MODEL = 'claude-sonnet-4-20250514'
const VALID_SCOPES = new Set(['this_agent', 'workspace', 'all_agents'])

const AUTO_REVIEW_SYSTEM_PREAMBLE = `You are an experienced conversational-AI engineer auditing a production AI sales/support agent. Below you'll see the agent's configuration and a SIMULATED conversation that was just run against it to generate training signal — a persona-Claude played a customer with a specific communication style, and the real agent (under test) responded.

Your job: identify concrete, apply-able improvements to the agent's prompt, rules, or behaviour. Call the propose_improvement tool once for each DISTINCT improvement you see.

Ground rules:
1. Skew CONSERVATIVE. This is running unattended; every proposal creates work for a human approver. Propose zero if the agent handled the conversation well. Do not propose stylistic preferences.
2. Focus on observable failures: the agent asked for info already provided; the agent promised an action it didn't take; the agent hallucinated a detail; the agent missed an obvious close; the agent couldn't handle the persona's communication style.
3. Cite the turn number in the rationale ("Turn 4: agent re-asked for the email after Turn 2 provided it").
4. Distinguish between "config bug" (the prompt tells the agent to do the wrong thing) and "agent drift" (the prompt is fine but the agent didn't follow it). Say which in the rationale.

SCOPE GUIDANCE — important.
- "this_agent" (default): the fix is specific to THIS agent's business, tone, or config.
- "workspace": the fix is something the operator likely wants applied to every agent they run in this workspace.
- "all_agents": reserved for truly universal conversational-AI hygiene — behaviours that would be correct regardless of industry, tone, or customer. If you can imagine any legitimate customer for whom the rule should NOT apply, it is NOT all_agents.

Default HARD to "this_agent". Overuse of "all_agents" in auto-review will tank operator trust in the feature.`

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_improvement',
  description: 'Propose a concrete, apply-able change based on the simulated conversation. Only call when you have a specific, testable recommendation. May be called multiple times per review. Call ZERO TIMES if the agent performed well — that\'s an acceptable outcome.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: { type: 'string', enum: ['prompt_addition'] },
      scope: { type: 'string', enum: ['this_agent', 'workspace', 'all_agents'] },
      title: { type: 'string', description: 'Short 3–7 word label.' },
      content: { type: 'string', description: 'Imperative text to append to the system prompt. Under 400 chars.' },
      rationale: { type: 'string', description: 'One sentence citing the turn number + justifying the scope.' },
    },
    required: ['type', 'scope', 'title', 'content', 'rationale'],
  },
}

interface Turn {
  role: 'persona' | 'agent'
  content: string
  at: string
}

/**
 * Run the auto-review for a completed simulation. Creates an AgentReview
 * row + N PlatformLearning proposals, links them back to the Simulation.
 *
 * Idempotent-ish: if the sim already has a reviewId, we skip. A real
 * re-review would be an explicit admin action via the normal
 * conversation-review flow.
 */
export async function autoReviewSimulation(simulationId: string): Promise<void> {
  const sim = await db.simulation.findUnique({
    where: { id: simulationId },
    select: {
      id: true, agentId: true, workspaceId: true,
      personaContext: true, channel: true, style: true, goal: true,
      transcript: true, reviewId: true, createdByEmail: true,
    },
  })
  if (!sim) throw new Error(`Simulation ${simulationId} not found`)
  if (sim.reviewId) return   // already reviewed

  const agent = await db.agent.findUnique({
    where: { id: sim.agentId },
    select: {
      id: true, name: true, systemPrompt: true, agentType: true,
      businessContext: true, agentPersonaName: true, responseLength: true,
      formalityLevel: true, useEmojis: true, fallbackBehavior: true,
      fallbackMessage: true, workspaceId: true,
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
  if (!agent) throw new Error(`Target agent for simulation ${simulationId} missing`)

  const transcript = Array.isArray(sim.transcript) ? (sim.transcript as unknown as Turn[]) : []
  if (transcript.length === 0) {
    // Nothing to review. Mark as done with a synthetic empty review so
    // we don't keep retrying.
    return
  }

  const briefing = buildAutoReviewBriefing({
    agent,
    sim: {
      personaContext: sim.personaContext,
      style: sim.style,
      channel: sim.channel,
      goal: sim.goal,
    },
    transcript,
  })

  const systemPrompt = `${AUTO_REVIEW_SYSTEM_PREAMBLE}\n\n---\n\n${briefing}`

  // Prompt Claude with a single synthetic user turn asking it to review.
  // No admin back-and-forth for auto-review — this is a one-shot.
  const response = await client.messages.create({
    model: REVIEWER_MODEL,
    max_tokens: 2048,
    system: systemPrompt,
    tools: [PROPOSE_TOOL],
    tool_choice: { type: 'auto' },
    messages: [
      {
        role: 'user',
        content: `Review the simulation above. Propose improvements (or none) via the propose_improvement tool. After all tool calls, optionally write a one-paragraph summary of what you observed.`,
      },
    ],
  })

  const proseParts: string[] = []
  const proposalInputs: Array<{
    type: string
    scope: 'this_agent' | 'workspace' | 'all_agents'
    title: string
    content: string
    rationale: string
  }> = []

  for (const block of response.content) {
    if (block.type === 'text') {
      const txt = block.text.trim()
      if (txt) proseParts.push(txt)
    } else if (block.type === 'tool_use' && block.name === 'propose_improvement') {
      const input = block.input as Record<string, unknown>
      if (
        typeof input.type !== 'string' ||
        typeof input.title !== 'string' ||
        typeof input.content !== 'string' ||
        typeof input.rationale !== 'string'
      ) continue
      if (input.type !== 'prompt_addition') continue
      if (!input.title.trim() || !input.content.trim()) continue
      const rawScope = typeof input.scope === 'string' ? input.scope : 'this_agent'
      const scope = VALID_SCOPES.has(rawScope)
        ? (rawScope as 'this_agent' | 'workspace' | 'all_agents')
        : 'this_agent'
      proposalInputs.push({
        type: input.type,
        scope,
        title: input.title.trim().slice(0, 120),
        content: input.content.trim().slice(0, 4000),
        rationale: input.rationale.trim().slice(0, 1000),
      })
    }
  }

  const proseSummary = proseParts.join('\n\n').trim()
  const assistantMessage = {
    role: 'assistant' as const,
    content: proseSummary || `Reviewed — proposed ${proposalInputs.length} improvement${proposalInputs.length === 1 ? '' : 's'}.`,
    at: new Date().toISOString(),
    ...(proposalInputs.length > 0 ? { suggestionsPending: true } : {}),
  }

  // Single transaction: create the review, create each learning, backfill
  // sourceReviewId, attach suggestion metadata, update the simulation.
  const agentWorkspaceId = agent.workspaceId ?? agent.location?.workspaceId ?? null
  const adminEmail = sim.createdByEmail ?? 'auto-review@simulator'

  await db.$transaction(async (tx) => {
    // 1. Create learnings (sourceReviewId populated after review insert).
    const created = await Promise.all(
      proposalInputs.map(p =>
        tx.platformLearning.create({
          data: {
            sourceReviewId: null,
            scope: p.scope,
            workspaceId: p.scope === 'all_agents' ? null : agentWorkspaceId,
            agentId: p.scope === 'this_agent' ? agent.id : null,
            type: p.type,
            title: p.title,
            content: p.content,
            rationale: p.rationale,
            status: 'proposed',
            proposedByEmail: adminEmail,
          },
          select: { id: true, title: true, content: true, rationale: true, type: true, scope: true },
        }),
      ),
    )

    // 2. Compose review messages JSON.
    const assistantFull = {
      ...assistantMessage,
      ...(created.length > 0
        ? {
            suggestions: created.map(l => ({
              learningId: l.id,
              type: l.type,
              scope: l.scope,
              title: l.title,
              content: l.content,
              rationale: l.rationale,
            })),
          }
        : {}),
    }
    const reviewMessages = [
      {
        role: 'admin' as const,
        content: `[Auto-review of simulation ${sim.id}. Persona: ${sim.style} · channel: ${sim.channel}${sim.goal ? ` · goal: ${sim.goal}` : ''}]`,
        at: new Date().toISOString(),
      },
      assistantFull,
    ]

    // 3. Create AgentReview — contactId is the sim's synthetic contact.
    const review = await tx.agentReview.create({
      data: {
        agentId: agent.id,
        contactId: `sim-${sim.id}`,
        conversationId: null,
        adminId: null,
        adminEmail,
        title: `Auto-review: ${sim.style} ${sim.channel}`,
        messages: reviewMessages as unknown as object,
      },
    })

    // 4. Backfill sourceReviewId on the learnings.
    if (created.length > 0) {
      await tx.platformLearning.updateMany({
        where: { id: { in: created.map(l => l.id) } },
        data: { sourceReviewId: review.id },
      })
    }

    // 5. Link the review back onto the simulation.
    await tx.simulation.update({
      where: { id: sim.id },
      data: {
        reviewId: review.id,
        proposedLearningsCount: created.length,
      },
    })
  })
}

function buildAutoReviewBriefing(opts: {
  agent: any
  sim: { personaContext: string; style: string; channel: string; goal: string | null }
  transcript: Turn[]
}): string {
  const { agent, sim, transcript } = opts
  const parts: string[] = []

  parts.push(`# Simulation context`)
  parts.push(`Persona: ${sim.personaContext}`)
  parts.push(`Style: ${sim.style} · Channel: ${sim.channel}${sim.goal ? ` · Goal: ${sim.goal}` : ''}`)

  parts.push(`\n# Agent under review`)
  parts.push(`Name: ${agent.name}`)
  parts.push(`Type: ${agent.agentType}`)
  parts.push(`Persona: formality=${agent.formalityLevel}, replies=${agent.responseLength}, emojis=${agent.useEmojis}`)
  parts.push(`Fallback: ${agent.fallbackBehavior}${agent.fallbackMessage ? ` — "${agent.fallbackMessage}"` : ''}`)
  if (agent.businessContext) parts.push(`Business context: ${agent.businessContext}`)

  parts.push(`\n# System prompt`)
  parts.push(agent.systemPrompt || '(default)')

  if (agent.qualifyingQuestions?.length) {
    parts.push(`\n# Qualifying questions`)
    for (const q of agent.qualifyingQuestions) parts.push(`- [${q.fieldKey}] ${q.question}`)
  }
  if (agent.detectionRules?.length) {
    parts.push(`\n# Detection rules`)
    for (const r of agent.detectionRules) parts.push(`- ${r.name}: ${r.conditionDescription}`)
  }
  if (agent.listeningRules?.length) {
    parts.push(`\n# Listening rules`)
    for (const r of agent.listeningRules) parts.push(`- ${r.name}: ${r.description}`)
  }

  parts.push(`\n# Simulated conversation (${transcript.length} turns)`)
  parts.push(`"persona" = the simulated customer. "agent" = the agent under test.`)
  for (let i = 0; i < transcript.length; i++) {
    const t = transcript[i]
    parts.push(`\n[Turn ${i + 1} · ${t.role}]`)
    parts.push(t.content)
  }
  return parts.join('\n')
}
