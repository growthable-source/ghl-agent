import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { buildTicketReplyContext, findNegativeKeywordHits } from '@/lib/tickets/reply-context'

type Params = { params: Promise<{ workspaceId: string; ticketId: string }> }

/**
 * POST { agentId? } — draft a reply for this ticket using an agent's
 * brain. agentId is optional — when omitted we pick the first active
 * agent in the workspace. The draft is NOT sent or persisted; the
 * UI lets the operator edit before posting through /messages (or
 * routing through /submit-approval for portal sign-off).
 *
 * Context-aware: beyond the same Phase-2 retrieval the chat path uses
 * (now including the brand's portal-managed knowledge domain), the
 * prompt carries the brand's recent ticket history, the requester's
 * own open/past tickets, recent live-chat summaries on the brand, the
 * brand snippet library, and the brand's forbidden-phrase list. See
 * lib/tickets/reply-context.ts.
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

  const context = await buildTicketReplyContext({
    ticket: {
      id: ticket.id,
      workspaceId,
      brandId: ticket.brandId,
      contactEmail: ticket.contactEmail,
      subject: ticket.subject,
    },
    agent: {
      id: agent.id,
      knowledgeScopeAll: (agent as { knowledgeScopeAll?: boolean | null }).knowledgeScopeAll,
    },
    question,
  })

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
${context.knowledgeBlock}${context.requesterHistoryBlock}${context.brandHistoryBlock}${context.conversationsBlock}${context.snippetsBlock}${context.negativeKeywordsBlock}`

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
    const keywordHits = findNegativeKeywordHits(draft, context.negativeKeywords)
    return NextResponse.json({
      draft,
      agentId: agent.id,
      agentName: agent.name,
      knowledgeUsed: context.counts.knowledgeChunks,
      contextUsed: context.counts,
      // Forbidden phrases that slipped through despite the prompt rule —
      // surfaced as a warning so the operator edits before sending.
      keywordWarnings: keywordHits,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Anthropic call failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
