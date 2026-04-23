import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'
import { applyLearning } from './platform-learning'

/**
 * Per-turn feedback review.
 *
 * When a user thumbs-downs a specific agent reply in the playground,
 * we invoke Claude as a focused reviewer — it sees the full conversation
 * up to that point, the flagged reply, and the user's narrative ("why
 * was this wrong"). It proposes a SINGLE prompt_addition scoped to the
 * target agent that would have prevented the failure, then we auto-
 * apply it.
 *
 * Differences from the simulation auto-reviewer:
 *   - Laser-focused prompt — "propose at most ONE improvement for THIS
 *     turn, based on the user's narrative". No scope choice (always
 *     this_agent). No multi-proposal permission.
 *   - No AgentReview row needed — this is per-turn feedback, not a full
 *     conversation audit. The PlatformLearning row's `rationale` field
 *     captures the user narrative verbatim so the approval queue shows
 *     the operator's actual words.
 */

const client = new Anthropic()
const REVIEWER_MODEL = 'claude-sonnet-4-20250514'

const FEEDBACK_SYSTEM_PREAMBLE = `You are an experienced conversational-AI engineer. A user of a production AI agent just flagged one specific agent reply as wrong — they provided a narrative explaining why. Your job is to propose a SINGLE concrete prompt_addition that would prevent the agent from making the same mistake again.

Ground rules:
1. Be conservative. If the user's narrative is vague or the agent's reply was actually reasonable, propose NOTHING — call the tool zero times. A bad learning is worse than no learning.
2. If you do propose, the proposal must be:
   - Imperative (not "the agent should..." but "Never claim X when..."),
   - Specific to the failure mode shown in this turn,
   - Under 400 characters,
   - Universal enough to apply to future similar turns, not hyper-tied to this one conversation.
3. Scope is fixed at this_agent. You can't propose workspace or all_agents scope from this path.
4. If you propose, cite the failure concretely in the rationale — quote the relevant part of the agent's reply or the user's narrative.

Call the propose_improvement tool at most ONCE. Skip it entirely if the feedback doesn't justify a prompt change.`

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_improvement',
  description: 'Propose ONE concrete prompt_addition based on the user\'s feedback. Skip (call zero times) if the feedback doesn\'t justify a prompt change.',
  input_schema: {
    type: 'object' as const,
    properties: {
      title: { type: 'string', description: 'Short 3–7 word label, e.g. "Don\'t promise same-day approval".' },
      content: { type: 'string', description: 'Imperative text appended to the agent\'s system prompt. Under 400 chars.' },
      rationale: { type: 'string', description: 'One sentence: what did the agent do wrong + how this proposal prevents a repeat.' },
    },
    required: ['title', 'content', 'rationale'],
  },
}

interface FeedbackConversationTurn {
  role: 'user' | 'agent'
  content: string
}

/**
 * Run a focused review against a thumbs-down feedback event.
 *
 * Returns the created learning ID if a proposal was generated and
 * auto-applied, or null if the reviewer declined to propose anything
 * (the conservative path — not an error).
 */
export async function reviewPlaygroundFeedback(opts: {
  agentId: string
  conversation: FeedbackConversationTurn[]
  flaggedReplyIndex: number
  narrative: string
  submittedByEmail: string
}): Promise<{ ok: true; learningId: string | null } | { ok: false; error: string }> {
  const { agentId, conversation, flaggedReplyIndex, narrative, submittedByEmail } = opts

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true, name: true, systemPrompt: true, agentType: true,
      businessContext: true, agentPersonaName: true, responseLength: true,
      formalityLevel: true, useEmojis: true, workspaceId: true,
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
    },
  })
  if (!agent) return { ok: false, error: 'Agent not found' }

  if (!conversation[flaggedReplyIndex] || conversation[flaggedReplyIndex].role !== 'agent') {
    return { ok: false, error: 'flaggedReplyIndex does not point at an agent reply' }
  }

  const briefing = buildBriefing({ agent, conversation, flaggedReplyIndex, narrative })
  const systemPrompt = `${FEEDBACK_SYSTEM_PREAMBLE}\n\n---\n\n${briefing}`

  let response
  try {
    response = await client.messages.create({
      model: REVIEWER_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: [PROPOSE_TOOL],
      tool_choice: { type: 'auto' },
      messages: [{
        role: 'user',
        content: 'Review the feedback and propose a single prompt_addition if (and only if) it\'s warranted.',
      }],
    })
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'Reviewer call failed' }
  }

  // Extract the first (and only) propose_improvement tool call, if any.
  let proposal: { title: string; content: string; rationale: string } | null = null
  for (const block of response.content) {
    if (block.type !== 'tool_use') continue
    if (block.name !== 'propose_improvement') continue
    const input = block.input as Record<string, unknown>
    if (typeof input.title !== 'string' || !input.title.trim()) continue
    if (typeof input.content !== 'string' || !input.content.trim()) continue
    if (typeof input.rationale !== 'string') continue
    proposal = {
      title: input.title.trim().slice(0, 120),
      content: input.content.trim().slice(0, 4000),
      rationale: input.rationale.trim().slice(0, 1000),
    }
    break
  }

  if (!proposal) {
    // Reviewer declined — the feedback didn't justify a change. Not an
    // error; the user sees "no change needed" in the UI.
    return { ok: true, learningId: null }
  }

  // Create + auto-apply. The user narrative is surfaced in the
  // rationale alongside Claude's reasoning so the admin queue shows
  // both perspectives side-by-side.
  const workspaceId = agent.workspaceId ?? agent.location?.workspaceId ?? null
  const ratedBy = submittedByEmail
  const combinedRationale = `${proposal.rationale}\n\nUser feedback: "${narrative.trim().slice(0, 500)}"`

  const learning = await db.platformLearning.create({
    data: {
      sourceReviewId: null,
      scope: 'this_agent',
      workspaceId,
      agentId,
      type: 'prompt_addition',
      title: proposal.title,
      content: proposal.content,
      rationale: combinedRationale,
      status: 'approved',
      proposedByEmail: ratedBy,
      approvedByEmail: ratedBy,
    },
    select: { id: true },
  })

  const applyResult = await applyLearning(learning.id)
  if (!applyResult.ok) {
    return { ok: false, error: `Created learning but apply failed: ${applyResult.error}` }
  }

  return { ok: true, learningId: learning.id }
}

function buildBriefing(opts: {
  agent: any
  conversation: FeedbackConversationTurn[]
  flaggedReplyIndex: number
  narrative: string
}): string {
  const { agent, conversation, flaggedReplyIndex, narrative } = opts
  const parts: string[] = []

  parts.push(`# Agent under review`)
  parts.push(`Name: ${agent.name}`)
  parts.push(`Type: ${agent.agentType}`)
  parts.push(`Persona: formality=${agent.formalityLevel}, replies=${agent.responseLength}, emojis=${agent.useEmojis}`)
  if (agent.businessContext) parts.push(`Business context: ${agent.businessContext}`)

  parts.push(`\n# Current system prompt`)
  parts.push(agent.systemPrompt || '(default)')

  if (agent.detectionRules?.length) {
    parts.push(`\n# Detection rules`)
    for (const r of agent.detectionRules) parts.push(`- ${r.name}: ${r.conditionDescription}`)
  }
  if (agent.listeningRules?.length) {
    parts.push(`\n# Listening rules`)
    for (const r of agent.listeningRules) parts.push(`- ${r.name}: ${r.description}`)
  }

  parts.push(`\n# Playground conversation (${conversation.length} turns total)`)
  for (let i = 0; i < conversation.length; i++) {
    const t = conversation[i]
    const marker = i === flaggedReplyIndex ? '  ⟵ FLAGGED BY USER' : ''
    parts.push(`\n[Turn ${i + 1} · ${t.role}]${marker}`)
    parts.push(t.content)
  }

  parts.push(`\n# User's narrative about why the flagged reply was wrong`)
  parts.push(narrative.trim())

  return parts.join('\n')
}
