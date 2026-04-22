import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'

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
 * contact) conversation. We stuff the agent's real configuration and
 * the entire transcript into a system message — the reviewer doesn't
 * call the agent's tools, it just reasons about what the agent did and
 * why, and suggests prompt/rule changes.
 *
 * One review thread == one AgentReview row. The messages column is an
 * append-only JSON array of turns; we pass the full history on every
 * call so Claude keeps context across follow-ups.
 */

interface ReviewMessage {
  role: 'admin' | 'assistant'
  content: string
  at: string
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
3. When suggesting a fix, show the CONCRETE change — a rewritten sentence in the system prompt, a new detection rule, a specific listening rule. Not just "be clearer."
4. If the agent's behaviour was actually fine and the operator's concern is misplaced, say so.
5. You cannot change anything yourself. The operator takes your suggestions back to the agent config.

Format your responses as plain prose with short paragraphs. Use bullet points sparingly. Do not greet, do not sign off.`

function buildAgentBriefing(agent: any, messages: Array<{ role: string; content: string; createdAt: Date }>): string {
  // Build a single string Claude sees as system context. Keeps the
  // reviewer's call sites trivial and the briefing diffable.
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
  // First 60 chars of the admin's opening question — good enough to
  // scan the past-reviews list.
  const trimmed = firstAdminMessage.replace(/\s+/g, ' ').trim()
  return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 57) + '…'
}

export async function POST(req: NextRequest) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  // Lock down: the reviewer API must only ever operate on conversations
  // the admin can actually see via the list page. Admin is already gated
  // by 2FA at the layout, so no further tenant check is needed — but we
  // still confirm the agent exists so bad IDs don't OOM the LLM with junk.
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true, name: true, systemPrompt: true, agentType: true,
      businessContext: true, agentPersonaName: true, responseLength: true,
      formalityLevel: true, useEmojis: true, fallbackBehavior: true,
      fallbackMessage: true,
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
        // QualifyingQuestion has no isActive flag — all rows are live.
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

  // Load or create the review row. `reviewId` is null on the very first
  // admin message; we create the row, title it from that message, and
  // return the new ID so the client threads subsequent turns into it.
  let review = body.reviewId
    ? await db.agentReview.findUnique({ where: { id: body.reviewId } })
    : null

  const prior: ReviewMessage[] = review && Array.isArray(review.messages)
    ? (review.messages as unknown as ReviewMessage[])
    : []

  // Build the Anthropic call. System context = agent briefing. Message
  // array = the back-and-forth with the admin so far + this new turn.
  const briefing = buildAgentBriefing(agent, messages)
  const systemPrompt = `${REVIEWER_SYSTEM_PREAMBLE}\n\n---\n\n${briefing}`

  const anthMessages: Anthropic.MessageParam[] = prior.map(m => ({
    role: m.role === 'admin' ? 'user' : 'assistant',
    content: m.content,
  }))
  anthMessages.push({ role: 'user', content: adminMessage })

  let replyText: string
  try {
    const response = await client.messages.create({
      model: REVIEWER_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: anthMessages,
    })
    // Concatenate any text blocks. Reviewer has no tools, so this is
    // always a plain text completion, but being defensive is cheap.
    replyText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('\n')
      .trim()
    if (!replyText) {
      replyText = '(The reviewer returned an empty response — try rephrasing your question.)'
    }
  } catch (err: any) {
    const msg = err?.message ?? 'Reviewer call failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  const now = new Date()
  const newThread: ReviewMessage[] = [
    ...prior,
    { role: 'admin', content: adminMessage, at: now.toISOString() },
    { role: 'assistant', content: replyText, at: new Date().toISOString() },
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
        messages: newThread as unknown as object,
      },
    })
  } else {
    review = await db.agentReview.update({
      where: { id: review.id },
      data: { messages: newThread as unknown as object },
    })
  }

  logAdminAction({
    admin: session,
    action: 'conversation_review_turn',
    target: `${agentId}:${contactId}`,
    meta: { reviewId: review.id, turnCount: newThread.length },
  }).catch(() => {})

  return NextResponse.json({
    reviewId: review.id,
    messages: newThread,
  })
}
