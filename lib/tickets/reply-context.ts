/**
 * Context assembly for ticket reply drafting (suggest-reply).
 *
 * A support email is only as good as what the model knows when it writes
 * it. This module gathers, per ticket:
 *
 *   1. Indexed knowledge     — Phase-2 pgvector retrieval over the agent's
 *                              scoped domains PLUS the ticket brand's
 *                              portal-managed domain.
 *   2. Brand ticket history  — the last ~100 tickets logged for the brand,
 *                              one compact line each (recurring issues,
 *                              what's currently open).
 *   3. Requester history     — every recent ticket from the same
 *                              contactEmail, with summaries: outstanding
 *                              issues and how past ones were resolved.
 *   4. Brand conversations   — recent live-chat conversations on the
 *                              brand's widgets (cached AI summaries), with
 *                              the requester's own chats flagged.
 *   5. Snippet library       — brand-approved links/blurbs (calendar link,
 *                              contact details) the model may weave in
 *                              verbatim when clearly relevant.
 *   6. Negative keywords     — brand-forbidden words/phrases, enforced in
 *                              the prompt and re-checked after generation.
 *
 * Failure semantics match retrieval: every block degrades to '' rather
 * than breaking the draft. Pre-migration databases (no brandId column, no
 * BrandSnippet table) simply produce empty blocks.
 */

import { db } from '@/lib/db'
import { retrieveChunks, buildRetrievedKnowledgeBlock, type RetrievedChunk } from '@/lib/ingest/retrieve'
import { findBrandDomainId } from '@/lib/ingest/brand-domain'

const BRAND_TICKET_LIMIT = 100
const REQUESTER_TICKET_LIMIT = 20
const CONVERSATION_LIMIT = 30
const SNIPPET_LIMIT = 50
const SUMMARY_TRUNCATE = 220

export interface TicketForContext {
  id: string
  workspaceId: string
  brandId: string | null
  contactEmail: string
  subject: string
}

export interface AgentForContext {
  id: string
  knowledgeDomainIds?: string[] | null
  knowledgeScopeAll?: boolean | null
}

export interface TicketReplyContext {
  /** Prompt-ready blocks — empty strings when there's nothing to say. */
  knowledgeBlock: string
  brandHistoryBlock: string
  requesterHistoryBlock: string
  conversationsBlock: string
  snippetsBlock: string
  negativeKeywordsBlock: string
  /** Raw pieces for response metadata / post-checks. */
  chunks: RetrievedChunk[]
  negativeKeywords: string[]
  counts: {
    knowledgeChunks: number
    brandTickets: number
    requesterTickets: number
    conversations: number
    snippets: number
  }
}

export async function buildTicketReplyContext(args: {
  ticket: TicketForContext
  agent: AgentForContext
  question: string
}): Promise<TicketReplyContext> {
  const { ticket, agent, question } = args

  const [knowledge, brandTickets, requesterTickets, conversations, snippets, negativeKeywords] =
    await Promise.all([
      retrieveForTicket(ticket, agent, question),
      loadBrandTickets(ticket),
      loadRequesterTickets(ticket),
      loadBrandConversations(ticket),
      loadSnippets(ticket.brandId),
      loadNegativeKeywords(ticket.brandId),
    ])

  return {
    knowledgeBlock: buildRetrievedKnowledgeBlock(knowledge),
    brandHistoryBlock: formatBrandHistoryBlock(brandTickets),
    requesterHistoryBlock: formatRequesterHistoryBlock(requesterTickets, ticket.contactEmail),
    conversationsBlock: formatConversationsBlock(conversations, ticket.contactEmail),
    snippetsBlock: formatSnippetsBlock(snippets),
    negativeKeywordsBlock: formatNegativeKeywordsBlock(negativeKeywords),
    chunks: knowledge,
    negativeKeywords,
    counts: {
      knowledgeChunks: knowledge.length,
      brandTickets: brandTickets.length,
      requesterTickets: requesterTickets.length,
      conversations: conversations.length,
      snippets: snippets.length,
    },
  }
}

// ─── Loaders (each swallows failure to []) ──────────────────────────────────

async function retrieveForTicket(
  ticket: TicketForContext,
  agent: AgentForContext,
  question: string,
): Promise<RetrievedChunk[]> {
  if (!question || question.trim().length < 3) return []
  try {
    const brandDomainId = await findBrandDomainId(ticket.brandId)
    const scoped = agent.knowledgeScopeAll === false
    let domainIds = agent.knowledgeDomainIds ?? []
    // When the agent is scoped (explicit domain list, or scope-all off),
    // the brand's portal domain still joins the pool — a brand added that
    // knowledge specifically so ticket replies could use it. Workspace-wide
    // agents (empty list, scope-all on) already include it implicitly.
    if (brandDomainId && (scoped || domainIds.length > 0) && !domainIds.includes(brandDomainId)) {
      domainIds = [...domainIds, brandDomainId]
    }
    return await retrieveChunks(ticket.workspaceId, question, {
      limit: 6,
      knowledgeDomainIds: domainIds,
      scopeToDomains: scoped,
    })
  } catch {
    return []
  }
}

interface TicketLine {
  ticketNumber: number
  subject: string
  status: string
  summary: string | null
  createdAt: Date
  lastActivityAt: Date
}

async function loadBrandTickets(ticket: TicketForContext): Promise<TicketLine[]> {
  if (!ticket.brandId) return []
  try {
    return await db.ticket.findMany({
      where: { workspaceId: ticket.workspaceId, brandId: ticket.brandId, id: { not: ticket.id } },
      orderBy: { lastActivityAt: 'desc' },
      take: BRAND_TICKET_LIMIT,
      select: {
        ticketNumber: true, subject: true, status: true,
        summary: true, createdAt: true, lastActivityAt: true,
      },
    })
  } catch {
    return []
  }
}

async function loadRequesterTickets(ticket: TicketForContext): Promise<TicketLine[]> {
  if (!ticket.contactEmail) return []
  try {
    return await db.ticket.findMany({
      where: {
        workspaceId: ticket.workspaceId,
        contactEmail: { equals: ticket.contactEmail, mode: 'insensitive' },
        id: { not: ticket.id },
      },
      orderBy: { lastActivityAt: 'desc' },
      take: REQUESTER_TICKET_LIMIT,
      select: {
        ticketNumber: true, subject: true, status: true,
        summary: true, createdAt: true, lastActivityAt: true,
      },
    })
  } catch {
    return []
  }
}

interface ConversationLine {
  aiSummary: string | null
  status: string
  lastMessageAt: Date
  visitorEmail: string | null
  visitorName: string | null
}

async function loadBrandConversations(ticket: TicketForContext): Promise<ConversationLine[]> {
  if (!ticket.brandId) return []
  try {
    const rows = await db.widgetConversation.findMany({
      where: { widget: { brandId: ticket.brandId } },
      orderBy: { lastMessageAt: 'desc' },
      take: CONVERSATION_LIMIT,
      select: {
        aiSummary: true,
        status: true,
        lastMessageAt: true,
        visitor: { select: { email: true, name: true } },
      },
    })
    return rows.map(r => ({
      aiSummary: r.aiSummary,
      status: r.status,
      lastMessageAt: r.lastMessageAt,
      visitorEmail: r.visitor?.email ?? null,
      visitorName: r.visitor?.name ?? null,
    }))
  } catch {
    return []
  }
}

export interface SnippetLine {
  title: string
  content: string
  kind: string
}

async function loadSnippets(brandId: string | null): Promise<SnippetLine[]> {
  if (!brandId) return []
  try {
    return await db.brandSnippet.findMany({
      where: { brandId, isActive: true },
      orderBy: { createdAt: 'asc' },
      take: SNIPPET_LIMIT,
      select: { title: true, content: true, kind: true },
    })
  } catch {
    return [] // pre-migration: table missing
  }
}

async function loadNegativeKeywords(brandId: string | null): Promise<string[]> {
  if (!brandId) return []
  try {
    const brand = await db.brand.findUnique({
      where: { id: brandId },
      select: { negativeKeywords: true },
    })
    return (brand?.negativeKeywords ?? []).filter(k => k.trim().length > 0)
  } catch {
    return [] // pre-migration: column missing
  }
}

// ─── Pure formatters (unit-testable, no I/O) ────────────────────────────────

export function formatBrandHistoryBlock(tickets: TicketLine[]): string {
  if (tickets.length === 0) return ''
  const open = tickets.filter(t => t.status === 'open' || t.status === 'pending').length
  const lines = tickets.map(t =>
    `#${t.ticketNumber} · ${t.status} · ${relativeDays(t.lastActivityAt)} · ${truncate(t.subject, 90)}`,
  )
  return `

## RECENT TICKETS FOR THIS BRAND (${tickets.length} shown, ${open} open/pending)
Background only — spot recurring problems and current themes. Do not mention ticket numbers to the customer.

${lines.join('\n')}`
}

export function formatRequesterHistoryBlock(tickets: TicketLine[], contactEmail: string): string {
  if (tickets.length === 0) return ''
  const lines = tickets.map(t => {
    const flag = t.status === 'open' || t.status === 'pending' || t.status === 'on_hold' ? ' [STILL OPEN]' : ''
    const summary = t.summary ? ` — ${truncate(t.summary.replace(/\s+/g, ' '), SUMMARY_TRUNCATE)}` : ''
    return `#${t.ticketNumber} · ${t.status}${flag} · ${relativeDays(t.lastActivityAt)} · ${truncate(t.subject, 90)}${summary}`
  })
  return `

## THIS CUSTOMER'S OTHER TICKETS (${contactEmail})
Their outstanding and past issues. Acknowledge related open issues naturally if the customer references them; never claim an issue is resolved unless its status says so.

${lines.join('\n')}`
}

export function formatConversationsBlock(conversations: ConversationLine[], contactEmail: string): string {
  const withSummary = conversations.filter(c => c.aiSummary)
  if (withSummary.length === 0) return ''
  const email = contactEmail.toLowerCase()
  const lines = withSummary.map(c => {
    const who = c.visitorEmail?.toLowerCase() === email
      ? 'THIS CUSTOMER'
      : (c.visitorName || c.visitorEmail || 'visitor')
    return `[${relativeDays(c.lastMessageAt)} · ${who}] ${truncate(c.aiSummary!.replace(/\s+/g, ' '), SUMMARY_TRUNCATE)}`
  })
  return `

## RECENT LIVE-CHAT CONVERSATIONS ON THIS BRAND
What customers have been chatting about lately (AI summaries). Lines marked THIS CUSTOMER are the ticket requester's own chats.

${lines.join('\n')}`
}

export function formatSnippetsBlock(snippets: SnippetLine[]): string {
  if (snippets.length === 0) return ''
  const lines = snippets.map(s => `- ${s.title}: ${truncate(s.content.replace(/\s+/g, ' '), 400)}`)
  return `

## BRAND SNIPPET LIBRARY
Pre-approved links and blurbs from the brand. When one clearly helps (e.g. the customer should book a call → include the calendar link), weave it into the reply VERBATIM. Never invent or alter links; if no snippet fits, use none.

${lines.join('\n')}`
}

export function formatNegativeKeywordsBlock(keywords: string[]): string {
  if (keywords.length === 0) return ''
  return `

## FORBIDDEN WORDS AND PHRASES
The brand forbids the following in replies. Never use them — pick a neutral alternative instead:
${keywords.map(k => `- "${k}"`).join('\n')}`
}

/**
 * Post-generation check: which forbidden keywords appear in the draft?
 * Case-insensitive substring match — deliberately strict, since the point
 * is a human-visible warning, not automated blocking.
 */
export function findNegativeKeywordHits(draft: string, keywords: string[]): string[] {
  const haystack = draft.toLowerCase()
  return keywords.filter(k => {
    const needle = k.trim().toLowerCase()
    return needle.length > 0 && haystack.includes(needle)
  })
}

function truncate(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

function relativeDays(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return '1d ago'
  if (days < 60) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}
