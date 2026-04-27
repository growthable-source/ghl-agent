import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import Anthropic from '@anthropic-ai/sdk'

/**
 * Weekly experiment-proposer cron.
 *
 * For each active agent that has handled enough conversations to be
 * worth experimenting on (≥30 inbounds last 7 days, ≥1 lost-or-stalled
 * conversation), call Sonnet with a snapshot of recent activity and ask
 * for a hypothesis + a candidate variantBPrompt that might improve
 * book/conversion rate. Save as a draft AgentExperiment for the operator
 * to review and approve.
 *
 * Runs Mondays at 14:00 UTC. Idempotent enough — produces at most one
 * new draft per agent per run; if the agent already has a draft from a
 * prior run, we skip rather than stack drafts.
 */

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const PROPOSER_TOOL: Anthropic.Tool = {
  name: 'propose_experiment',
  description: 'Once you have a hypothesis worth testing, call this with the configuration. Only call this if you genuinely believe variant B is likely to outperform the current behavior — otherwise return text saying "no recommendation".',
  input_schema: {
    type: 'object',
    properties: {
      hypothesis: {
        type: 'string',
        description: 'One sentence describing what you think will improve and why. E.g. "Opening with a question instead of a statement should lift booking rate because contacts who reply to a question are more committed."',
      },
      variantBPrompt: {
        type: 'string',
        description: 'Plain-English instructions appended to the agent\'s system prompt for variant B contacts. Concise — 1-3 sentences. This is what the agent will actually see during conversations.',
      },
      metric: {
        type: 'string',
        description: 'Which AgentGoal the experiment measures. Use "any_goal" unless one specific goal type matters most.',
      },
    },
    required: ['hypothesis', 'variantBPrompt', 'metric'],
  },
}

const SYSTEM_PROMPT = `You are an experienced conversion-rate-optimization expert reviewing how an AI sales/support agent is performing. Your job is to spot a single, testable improvement to the agent's behavior — usually a tweak to its opening line, tone, framing, or follow-up style — and propose it as an A/B experiment.

Rules:
- Only propose ONE experiment per call. Pick your highest-confidence hypothesis.
- Propose specific, falsifiable changes ("ask a question first" not "be more engaging").
- variantBPrompt should be short and actionable. The agent will follow it literally.
- If the data shows no obvious area for improvement, return text saying "no recommendation" without calling the tool.
- Don't propose risky changes (don't tell the agent to skip qualification, make false promises, or change pricing language).`

interface AgentSnapshot {
  agentId: string
  agentName: string
  systemPrompt: string
  inboundsCount: number
  bookings: number
  losses: Array<{ inbound: string; reply: string | null }>
}

async function buildAgentSnapshot(agent: { id: string; name: string; systemPrompt: string }): Promise<AgentSnapshot | null> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const inbounds = await db.messageLog.count({
    where: { agentId: agent.id, createdAt: { gte: since } },
  })
  if (inbounds < 30) return null

  // Booking conversions in window
  const goals = await db.agentGoal.findMany({
    where: { agentId: agent.id, isActive: true, goalType: 'appointment_booked' },
    select: { id: true },
  })
  const bookings = goals.length === 0 ? 0 : await db.agentGoalEvent.count({
    where: { goalId: { in: goals.map(g => g.id) }, achievedAt: { gte: since } },
  })

  // Sample of inbounds that didn't end in a booking — these are the "lost"
  // conversations the proposer should focus on.
  const recentLogs = await db.messageLog.findMany({
    where: { agentId: agent.id, createdAt: { gte: since }, status: 'SUCCESS' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { contactId: true, inboundMessage: true, outboundReply: true, actionsPerformed: true },
  })
  const losses = recentLogs
    .filter(l => !l.actionsPerformed.includes('book_appointment'))
    .slice(0, 12)
    .map(l => ({ inbound: l.inboundMessage, reply: l.outboundReply }))

  if (losses.length === 0) return null

  return {
    agentId: agent.id,
    agentName: agent.name,
    systemPrompt: agent.systemPrompt,
    inboundsCount: inbounds,
    bookings,
    losses,
  }
}

async function proposeForAgent(snap: AgentSnapshot) {
  const userContent = `Agent: ${snap.agentName}

Last 7 days: ${snap.inboundsCount} inbound conversations, ${snap.bookings} bookings.

Current system prompt (truncated to 2000 chars):
${snap.systemPrompt.slice(0, 2000)}

Sample of conversations that DIDN'T result in a booking — pick patterns:
${snap.losses.map((l, i) => `[${i + 1}] Inbound: "${l.inbound.slice(0, 200)}"\n     Agent: "${(l.reply || '').slice(0, 200)}"`).join('\n\n')}

Propose at most one experiment.`

  const res = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    tools: [PROPOSER_TOOL],
    messages: [{ role: 'user', content: userContent }],
  })

  const tool = res.content.find(b => b.type === 'tool_use' && b.name === 'propose_experiment') as Anthropic.ToolUseBlock | undefined
  if (!tool) return null
  return tool.input as { hypothesis: string; variantBPrompt: string; metric: string }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const agents = await db.agent.findMany({
    where: { isActive: true, isPaused: false },
    select: { id: true, name: true, systemPrompt: true },
  })

  let proposed = 0
  let skippedNoData = 0
  let skippedHasDraft = 0
  for (const agent of agents) {
    try {
      const existingDraft = await (db as any).agentExperiment.findFirst({
        where: { agentId: agent.id, status: 'draft' },
        select: { id: true },
      }).catch(() => null)
      if (existingDraft) { skippedHasDraft++; continue }

      const snap = await buildAgentSnapshot(agent)
      if (!snap) { skippedNoData++; continue }

      const proposal = await proposeForAgent(snap)
      if (!proposal) continue

      await (db as any).agentExperiment.create({
        data: {
          agentId: agent.id,
          hypothesis: proposal.hypothesis,
          variantBPrompt: proposal.variantBPrompt,
          metric: proposal.metric || 'any_goal',
          splitPercent: 50,
          status: 'draft',
          proposedBy: 'ai',
        },
      })
      proposed++
    } catch (err: any) {
      console.warn(`[ExperimentProposer] agent ${agent.id} failed:`, err.message)
    }
  }

  return NextResponse.json({
    proposed,
    skippedNoData,
    skippedHasDraft,
    totalAgents: agents.length,
  })
}
