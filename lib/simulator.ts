import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'
import { runAgent } from './ai-agent'
import type { Message } from '@/types'

/**
 * Conversation simulator.
 *
 * Runs a synthetic chat between:
 *   - A "persona Claude" — a lightweight LLM prompted to play a specific
 *     customer profile (context + communication style + optional goal).
 *   - The real agent under test, invoked through runAgent({ sandbox: true })
 *     so tool calls no-op against the CRM and nothing leaks into the
 *     customer's real contact/opportunity data.
 *
 * The loop alternates turns until one of:
 *   - the persona signals done (emits a specific end token),
 *   - maxTurns is reached,
 *   - an error is thrown.
 *
 * After the loop, autoReviewSimulation() (lib/auto-review.ts) picks up
 * the transcript and proposes PlatformLearnings headlessly.
 */

const client = new Anthropic()

// Use a slightly cheaper model for the persona to keep cost manageable
// across large swarms. The persona only needs to maintain a role — it's
// not the thing under test, so smaller/faster is fine.
const PERSONA_MODEL = 'claude-haiku-4-5'
const PERSONA_END_TOKEN = '[END_CONVERSATION]'
const MAX_PERSONA_REPLY_CHARS = 500

export type SimStyle =
  | 'friendly'
  | 'aggressive'
  | 'passive'
  | 'skeptical'
  | 'confused'
  | 'ready_to_buy'
  | 'price_shopper'

export const VALID_STYLES: SimStyle[] = [
  'friendly', 'aggressive', 'passive', 'skeptical',
  'confused', 'ready_to_buy', 'price_shopper',
]

export const VALID_CHANNELS = ['SMS', 'Email', 'WhatsApp', 'Live_Chat'] as const

/**
 * Per-style behavioural brief injected into the persona's system prompt.
 * Deliberately short — most behaviour comes from the operator's context
 * field. These flavour the style without dictating content.
 */
const STYLE_PROMPTS: Record<SimStyle, string> = {
  friendly: 'Be warm, cooperative, and patient. Answer questions directly.',
  aggressive: 'Be curt, demanding, and impatient. Push back if the agent is vague or repetitive. Threaten to walk away early if the agent wastes your time.',
  passive: 'Be non-committal, one-word answers when possible. Don\'t volunteer information. The agent has to pull details out of you.',
  skeptical: 'Question everything. Ask "how do I know that?" or "what\'s the catch?" frequently. You\'ve been burned before.',
  confused: 'Mix up details, forget what you asked, ask clarifying questions about things that were already answered. Test whether the agent can keep you on track.',
  ready_to_buy: 'You already want what the agent offers. You\'re ready to book/sign up/purchase. Push the agent to move to close — get frustrated if they meander.',
  price_shopper: 'Focus relentlessly on price. Compare to competitors. Ask for discounts multiple times. Refuse to commit without a concession.',
}

export interface PersonaConfig {
  context: string            // "You are a small business owner looking for SMS marketing..."
  style: SimStyle
  channel: (typeof VALID_CHANNELS)[number]
  goal?: string | null       // "Try to book a demo" (optional — for the persona's internal objective)
  maxTurns: number
}

export interface TranscriptTurn {
  role: 'persona' | 'agent'
  content: string
  at: string
  toolCalls?: Array<{ tool: string; input: unknown; output: string }>
}

function buildPersonaSystemPrompt(cfg: PersonaConfig): string {
  return `You are role-playing as a customer in a SIMULATION designed to test an AI sales/support agent. You are NOT an AI assistant — you are a specific human persona defined below.

# Who you are
${cfg.context}

# Communication style — ${cfg.style}
${STYLE_PROMPTS[cfg.style]}

# Channel
You're messaging over ${cfg.channel}. Keep replies short and realistic for that medium (SMS = 1–2 sentences; email = a bit longer).

# Your internal goal (the agent doesn't know this)
${cfg.goal ?? 'React naturally. There is no specific outcome you have to drive.'}

# Hard rules
- STAY in character as a human customer. Never say "I am an AI" or break the fourth wall.
- Reply with only the message you would send. No stage directions, no meta-commentary.
- When you feel the conversation has naturally concluded (booked, declined, walked away, or the agent gave up), end your reply with the literal token ${PERSONA_END_TOKEN} on its own line. The simulator uses this to stop the loop.
- Do NOT use the end token just to get out of a hard question — a real customer pushes back, asks follow-ups, or ghosts with a short "I'll think about it." Only end when the scenario truly has nowhere left to go.

Respond with your next message.`
}

/**
 * Ask the persona-Claude for its next message given the conversation
 * so far. Returns both the visible message content and whether the
 * persona signalled end-of-conversation.
 */
async function personaTurn(
  cfg: PersonaConfig,
  transcript: TranscriptTurn[],
): Promise<{ content: string; ended: boolean }> {
  // Map our internal transcript to Anthropic's role terms. The persona
  // sees the AGENT's messages as "assistant" in its chat UI — no wait,
  // actually the opposite: from the persona's POV, THEY are the user
  // typing messages, and the AGENT's replies are the "assistant"
  // responses... but here the persona IS the role-player, so we flip:
  // persona's own prior messages are 'assistant' (what they said),
  // agent's messages are 'user' (what they're replying to).
  const messages: Anthropic.MessageParam[] = transcript.map(t => ({
    role: t.role === 'persona' ? 'assistant' : 'user',
    content: t.content,
  }))
  // Kick-start: if the transcript is empty, prime with an opener.
  if (messages.length === 0) {
    messages.push({
      role: 'user',
      content: '[Start of conversation — send your opening message to the agent.]',
    })
  }

  const res = await client.messages.create({
    model: PERSONA_MODEL,
    max_tokens: 400,
    system: buildPersonaSystemPrompt(cfg),
    messages,
  })

  const raw = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()

  const ended = raw.includes(PERSONA_END_TOKEN)
  const content = raw.replace(PERSONA_END_TOKEN, '').trim().slice(0, MAX_PERSONA_REPLY_CHARS)
  return { content, ended }
}

/**
 * Invoke the real agent on the persona's latest message. Uses sandbox=true
 * so CRM calls no-op; the agent still reasons, picks tools, and writes a
 * reply as if it were a real inbound.
 */
async function agentTurn(params: {
  agentId: string
  locationId: string
  contactId: string
  channel: string
  systemPrompt: string
  enabledTools: string[]
  messageHistory: Message[]
  incomingMessage: string
}): Promise<{ reply: string; toolCalls: Array<{ tool: string; input: unknown; output: string }> }> {
  const result = await runAgent({
    agentId: params.agentId,
    locationId: params.locationId,
    contactId: params.contactId,
    channel: params.channel,
    incomingMessage: params.incomingMessage,
    messageHistory: params.messageHistory,
    systemPrompt: params.systemPrompt,
    enabledTools: params.enabledTools,
    sandbox: true,
  })
  return {
    reply: result.reply ?? '(agent produced no reply)',
    toolCalls: result.toolCallTrace.map(t => ({ tool: t.tool, input: t.input, output: t.output })),
  }
}

/**
 * Run one full simulation to completion. Streams progress into the DB
 * so the UI can poll and see turns land as they happen. Returns the
 * final transcript (also persisted). Safe to call from both the
 * synchronous route (customer clicking "run now") and the cron worker
 * (processing queued sims).
 */
export async function runSimulation(simulationId: string): Promise<void> {
  const sim = await db.simulation.findUnique({
    where: { id: simulationId },
    include: {
      agent: {
        select: {
          id: true, locationId: true, systemPrompt: true, enabledTools: true,
        },
      },
    },
  })
  if (!sim) throw new Error(`Simulation ${simulationId} not found`)
  if (sim.status !== 'queued' && sim.status !== 'running') {
    // Already complete/failed — don't re-run.
    return
  }
  if (!sim.agent) {
    await markFailed(simulationId, 'Target agent no longer exists')
    return
  }

  await db.simulation.update({
    where: { id: simulationId },
    data: { status: 'running', startedAt: new Date() },
  })

  const cfg: PersonaConfig = {
    context: sim.personaContext,
    style: sim.style as SimStyle,
    channel: sim.channel as (typeof VALID_CHANNELS)[number],
    goal: sim.goal,
    maxTurns: sim.maxTurns,
  }

  // Each simulation gets a synthetic contactId. runAgent's sandbox
  // detection keys off either sandbox=true OR contactId starting with
  // "playground-"; we use a distinct prefix so audit logs can tell the
  // two modes apart later.
  const contactId = `sim-${sim.id}`

  const transcript: TranscriptTurn[] = []

  try {
    // Loop: persona → agent → persona → agent … until end or maxTurns.
    // Each iteration adds TWO turns (one of each) unless the persona ends.
    for (let i = 0; i < cfg.maxTurns; i++) {
      // Persona speaks first in the loop — on iter 0 this is the
      // opening message; on later iters it's a reply to the agent.
      const { content: personaMsg, ended } = await personaTurn(cfg, transcript)
      if (!personaMsg) break    // persona produced nothing usable
      transcript.push({
        role: 'persona',
        content: personaMsg,
        at: new Date().toISOString(),
      })
      await persistProgress(simulationId, transcript)

      if (ended) break

      // Build messageHistory in runAgent's expected shape. Inbound =
      // from the persona, outbound = from the agent. The Message type
      // wants several CRM-side fields we don't have in a sandbox
      // context; stub them with synthetic values since runAgent only
      // reads `direction` and `body` out of the history.
      const messageHistory: Message[] = transcript.slice(0, -1).map((t, idx) => ({
        id: `sim-${simulationId}-${idx}`,
        conversationId: `sim-${simulationId}`,
        locationId: sim.agent!.locationId,
        body: t.content,
        direction: t.role === 'persona' ? 'inbound' : 'outbound',
        dateAdded: t.at,
      }))

      const { reply, toolCalls } = await agentTurn({
        agentId: sim.agent.id,
        locationId: sim.agent.locationId,
        contactId,
        channel: cfg.channel,
        systemPrompt: sim.agent.systemPrompt,
        enabledTools: sim.agent.enabledTools,
        messageHistory,
        incomingMessage: personaMsg,
      })

      transcript.push({
        role: 'agent',
        content: reply,
        at: new Date().toISOString(),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      })
      await persistProgress(simulationId, transcript)
    }

    await db.simulation.update({
      where: { id: simulationId },
      data: {
        status: 'complete',
        completedAt: new Date(),
        turnCount: transcript.length,
        transcript: transcript as unknown as object,
      },
    })
  } catch (err: any) {
    await markFailed(simulationId, err?.message ?? 'Simulation failed')
    return
  }

  // Fire auto-review — lazy import to avoid a require-cycle with any
  // file that imports this one.
  try {
    const { autoReviewSimulation } = await import('./auto-review')
    await autoReviewSimulation(simulationId)
  } catch (err: any) {
    // Review failure is non-fatal — sim is still useful as a transcript.
    console.warn(`[Simulator] auto-review failed for ${simulationId}:`, err?.message)
  }
}

async function persistProgress(simulationId: string, transcript: TranscriptTurn[]): Promise<void> {
  await db.simulation.update({
    where: { id: simulationId },
    data: {
      turnCount: transcript.length,
      transcript: transcript as unknown as object,
    },
  })
}

async function markFailed(simulationId: string, message: string): Promise<void> {
  await db.simulation.update({
    where: { id: simulationId },
    data: {
      status: 'failed',
      errorMessage: message.slice(0, 2000),
      completedAt: new Date(),
    },
  }).catch(() => {})
}
