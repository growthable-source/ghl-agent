import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { retrieveAndFormatForAgent } from '@/lib/agent/retrieve-for-agent'

type Params = { params: Promise<{ workspaceId: string; ticketId: string }> }

/**
 * POST { agentId? } — draft a reply for this ticket using an agent's
 * brain. agentId is optional — when omitted we pick the first active
 * agent in the workspace. The draft is NOT sent or persisted; the
 * UI lets the operator edit before posting through /messages.
 *
 * Knowledge-aware: runs the same Phase-2 retrieval the chat path
 * uses, so suggested replies can quote the help center / docs the
 * agent is scoped to.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, ticketId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, workspaceId },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 50 },
    },
  })
  if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const agentId = typeof body.agentId === 'string' ? body.agentId : null

  const agent = agentId
    ? await db.agent.findFirst({ where: { id: agentId, workspaceId } })
    : await db.agent.findFirst({ where: { workspaceId, isActive: true }, orderBy: { createdAt: 'asc' } })
  if (!agent) {
    return NextResponse.json({ error: 'No agent available. Create one first.' }, { status: 400 })
  }

  // Build the prompt. We don't reuse buildBasePrompt because this is
  // an OUTBOUND email composition, not a chat reply — the model needs
  // different framing (greeting, sign-off, longer-form acceptable).
  const lastInbound = [...ticket.messages].reverse().find(m => m.direction === 'inbound')
  const question = lastInbound?.body ?? ticket.subject
  const phase2 = await retrieveAndFormatForAgent(
    { id: agent.id, workspaceId, knowledgeDomainIds: (agent as { knowledgeDomainIds?: string[] }).knowledgeDomainIds },
    question,
  )

  const thread = ticket.messages.map(m => {
    const who = m.direction === 'inbound'
      ? `CUSTOMER (${ticket.contactName || ticket.contactEmail})`
      : m.direction === 'outbound' ? 'SUPPORT TEAM'
      : 'INTERNAL NOTE'
    return `${who}:\n${m.body}`
  }).join('\n\n---\n\n')

  const systemPrompt = `${agent.systemPrompt}

You are drafting an EMAIL reply to a support ticket — not a live chat. Write in the style your agent persona would, but adapt for email:
- Greet the customer by name if available (${ticket.contactName || 'no name available'})
- Address their question clearly and completely
- Use paragraphs, not chat-style fragments
- Sign off professionally; do NOT add a signature block (the system appends one)
- Plain text only — no markdown, no asterisks

The customer's subject was: "${ticket.subject}"
Ticket #${ticket.ticketNumber}.

${agent.instructions ? `\nAdditional instructions:\n${agent.instructions}\n` : ''}
${phase2.block}`

  const userPrompt = `Here is the full ticket thread so far (oldest first). Draft the support team's next reply.

${thread}`

  const client = new Anthropic()
  try {
    const completion = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const text = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    const draft = (text?.text ?? '').trim()
    if (!draft) {
      return NextResponse.json({ error: 'Empty draft from model. Try again or refine the ticket history.' }, { status: 502 })
    }
    return NextResponse.json({
      draft,
      agentId: agent.id,
      agentName: agent.name,
      knowledgeUsed: phase2.chunks.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Anthropic call failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
