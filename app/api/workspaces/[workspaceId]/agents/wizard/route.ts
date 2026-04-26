import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { ALL_TOOLS } from '@/lib/tools'
import Anthropic from '@anthropic-ai/sdk'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST /api/workspaces/:workspaceId/agents/wizard
 * Body: { messages: [{ role: 'user' | 'assistant', content: string }, ...] }
 *
 * Conversational agent designer. The model asks clarifying questions until
 * it has enough info, then calls the `propose_agent_config` tool with a
 * complete configuration. The client shows the proposal in a card; on
 * accept, it POSTs to /create with the proposal payload.
 *
 * Response shapes:
 *   { reply: string }              — model needs more info, here's its question
 *   { proposal: AgentProposal }    — model is ready, here's the config
 */

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const TOOL_CATALOG = ALL_TOOLS.map(t => `  - ${t.name}: ${t.description}`).join('\n')

const WIZARD_SYSTEM_PROMPT = `You are an expert AI agent designer helping a non-technical user spin up a new conversational agent in a CRM platform. Your job is to gather the minimum information needed to produce a working agent, then output a complete configuration.

## Your conversation loop
1. Greet briefly and ask what the agent should do (in plain English).
2. Ask clarifying questions ONE AT A TIME, max 5 total. Topics to cover:
   - The agent's job (sales / support / scheduling / follow-up / something else)
   - The tone / persona (professional, casual, energetic, formal)
   - Key behaviors or rules ("never quote prices", "always offer Tuesday first")
   - What outcome counts as a win (booking, qualification, ticket created)
3. Once you have enough to build, call \`propose_agent_config\` with the full configuration.

## Be efficient
- Don't ask about technical details (tools, integrations, channels) — you'll pick reasonable defaults.
- Don't ask three questions in one message. ONE question at a time.
- If the user gives you everything in the first message, propose immediately.
- Never explain the technology. Talk like a sharp colleague helping someone scope their job.

## Available tools (you'll pick a sensible subset for the agent)
${TOOL_CATALOG}

## Output rules
- Keep questions short (1-2 sentences).
- When you call propose_agent_config, also send a one-line text summary so the user knows what just happened.`

const PROPOSE_TOOL: Anthropic.Tool = {
  name: 'propose_agent_config',
  description: 'Once you have enough info, call this with the complete agent configuration. The user will see it as a card and click "Create" to actually build the agent.',
  input_schema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Short human-readable name for the agent, e.g. "Lead Qualifier" or "Booking Assistant".',
      },
      summary: {
        type: 'string',
        description: 'One-sentence description shown to the user explaining what this agent does.',
      },
      systemPrompt: {
        type: 'string',
        description: "The agent's core role + identity. Sets who the agent is and what it's responsible for. Keep under 200 words.",
      },
      instructions: {
        type: 'string',
        description: 'Behavior rules — bullet list of dos and don\'ts. Concise (under 150 words).',
      },
      enabledTools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Subset of tool names from the available tools list. Pick the minimum set that covers the agent\'s job.',
      },
      detectionRules: {
        type: 'array',
        description: 'Optional. Plain-English "if X then Y" rules — e.g. "If contact mentions a refund, tag with refund-request". Up to 3.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short name, e.g. "Refund mention".' },
            description: { type: 'string', description: 'Plain-English condition, e.g. "Contact asks for a refund or expresses frustration about charges."' },
            actionType: { type: 'string', enum: ['add_tag', 'add_note', 'add_to_workflow'], description: 'What action to take when the rule fires.' },
            actionValue: { type: 'string', description: 'Tag name / note text / workflow id depending on actionType.' },
          },
          required: ['name', 'description', 'actionType', 'actionValue'],
        },
      },
      qualifyingQuestions: {
        type: 'array',
        description: 'Optional. Questions the agent should naturally work into the conversation to qualify the contact. Up to 4.',
        items: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'The question itself, conversational phrasing.' },
            captureField: { type: 'string', description: 'Where to store the answer (CRM field name like "budget" or "timeline" — use lowercase_snake_case).' },
          },
          required: ['question', 'captureField'],
        },
      },
      personaTone: {
        type: 'string',
        enum: ['professional', 'friendly', 'casual', 'energetic', 'formal'],
        description: 'Overall personality vibe.',
      },
    },
    required: ['name', 'summary', 'systemPrompt', 'instructions', 'enabledTools'],
  },
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const messages = Array.isArray(body.messages) ? body.messages : []
  if (messages.length === 0) {
    return NextResponse.json({ error: 'messages array required' }, { status: 400 })
  }

  // Drop empty messages and trim to last 30 turns to keep latency reasonable.
  const cleaned = messages
    .filter((m: any) => m && typeof m.content === 'string' && m.content.trim() && (m.role === 'user' || m.role === 'assistant'))
    .slice(-30)
    .map((m: any) => ({ role: m.role, content: m.content }))

  try {
    const res = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: WIZARD_SYSTEM_PROMPT,
      tools: [PROPOSE_TOOL],
      messages: cleaned,
    })

    const proposalBlock = res.content.find(b => b.type === 'tool_use' && b.name === 'propose_agent_config') as Anthropic.ToolUseBlock | undefined
    const textBlock = res.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined
    const text = textBlock?.text || ''

    if (proposalBlock) {
      return NextResponse.json({ proposal: proposalBlock.input, summary: text })
    }
    return NextResponse.json({ reply: text || 'Tell me a bit more about what you want this agent to do.' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Wizard error' }, { status: 500 })
  }
}
