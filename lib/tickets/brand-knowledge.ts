/**
 * Agent learning from resolved interactions — the write-back half of the
 * brand-knowledge circle.
 *
 * Sources that feed it (all human-gated via the collection's Mined Q&A tab):
 *   - ticket_approval : a reply released through the approval queue
 *   - chat_csat       : a live-chat conversation the visitor rated highly
 *   - mining / manual : conversation mining + operator-authored pairs
 *
 * Two steps:
 *   stage*()          — distil the interaction into a Q&A and STAGE it as a
 *                       MinedQaPair for review. Nothing reaches an agent yet.
 *   embedQaAsChunk()  — on approval, embed the Q&A as a KnowledgeChunk in the
 *                       brand (or workspace) KnowledgeDomain. Chunks are what
 *                       BOTH the widget chat AND ticket suggest-reply retrieve
 *                       — a KnowledgeEntry would reach chat only.
 *
 * Every path is failure-tolerant: staging must never break the approval, the
 * customer email, or a CSAT submission, so it swallows to null on any error
 * (incl. pre-migration DBs missing the new columns).
 */

import { db } from '@/lib/db'
import { getOrCreateBrandCollection, getOrCreateBrandDomain } from '@/lib/ingest/brand-domain'
import { getOrCreateWorkspaceDomain } from '@/lib/ingest/workspace-domain'
import { distillResolutionToQa, distillTranscriptToQa, formatChatTranscript } from './resolution-to-qa'

// ── Staging (interaction → MinedQaPair) ─────────────────────────────────

interface StagedQa {
  question: string
  answer: string
  confidence: number
}

/**
 * Stage a distilled Q&A as a pending MinedQaPair on the brand's collection.
 * Brand-scoped: no brand → nowhere brand-specific to learn into → null.
 */
export async function stageResolutionLearning(input: {
  source: string
  brandId: string | null
  workspaceId: string
  qa: StagedQa
  sourceTicketId?: string | null
  sourceConversationId?: string | null
}): Promise<{ pairId: string } | null> {
  if (!input.brandId) return null
  const question = input.qa.question.trim()
  const answer = input.qa.answer.trim()
  if (!question || !answer) return null

  try {
    const collection = await getOrCreateBrandCollection(input.brandId)
    if (!collection) return null

    // Light dedup: don't re-stage an identical question already awaiting or
    // approved for this brand. Cross-phrasing dupes are caught by the reviewer.
    const existing = await db.minedQaPair.findFirst({
      where: { collectionId: collection.id, question, status: { in: ['pending', 'approved'] } },
      select: { id: true },
    })
    if (existing) return { pairId: existing.id }

    const pair = await db.minedQaPair.create({
      data: {
        workspaceId: input.workspaceId,
        collectionId: collection.id,
        source: input.source,
        sourceTicketId: input.sourceTicketId ?? null,
        sourceConversationId: input.sourceConversationId ?? null,
        question,
        answer,
        confidence: input.qa.confidence,
        status: 'pending',
      },
      select: { id: true },
    })
    return { pairId: pair.id }
  } catch {
    // Pre-migration (source/sourceTicketId columns missing) or transient —
    // learning is best-effort and must never surface to the caller.
    return null
  }
}

/** Ticket approval queue → learning. Distils the released reply. */
export async function stageTicketResolutionLearning(input: {
  ticket: { id: string; brandId: string | null; workspaceId: string }
  question: string
  answer: string
  brandName?: string | null
}): Promise<{ pairId: string } | null> {
  if (!input.ticket.brandId) return null
  if (!input.question.trim() || !input.answer.trim()) return null
  const qa = await distillResolutionToQa({
    question: input.question,
    reply: input.answer,
    brandName: input.brandName,
  })
  return stageResolutionLearning({
    source: 'ticket_approval',
    brandId: input.ticket.brandId,
    workspaceId: input.ticket.workspaceId,
    qa,
    sourceTicketId: input.ticket.id,
  })
}

/**
 * Highly-rated live chat → learning. Loads the conversation, builds a
 * transcript, and stages the single most reusable Q&A. Called best-effort
 * from the widget CSAT endpoint on a good rating.
 */
export async function stageChatCsatLearningFromConversation(
  conversationId: string,
): Promise<{ pairId: string } | null> {
  try {
    const convo = await db.widgetConversation.findUnique({
      where: { id: conversationId },
      select: {
        widget: { select: { brandId: true, workspaceId: true, brand: { select: { name: true } } } },
        messages: {
          orderBy: { createdAt: 'asc' },
          select: { role: true, content: true, kind: true },
        },
      },
    })
    if (!convo?.widget?.brandId) return null

    const transcript = formatChatTranscript(convo.messages)
    if (transcript.length < 20) return null

    const qa = await distillTranscriptToQa({ transcript, brandName: convo.widget.brand?.name ?? null })
    if (!qa) return null

    return stageResolutionLearning({
      source: 'chat_csat',
      brandId: convo.widget.brandId,
      workspaceId: convo.widget.workspaceId,
      qa,
      sourceConversationId: conversationId,
    })
  } catch {
    return null
  }
}

// ── Embedding (approved Q&A → KnowledgeChunk) ───────────────────────────

/**
 * Queue a Q&A pair for embedding as a chunk. Targets the brand's
 * KnowledgeDomain when brandId is given, else the workspace domain. Returns
 * the created source + run, or null if no domain resolves or the write fails.
 * The ingest-queue cron does the chunk/embed shortly after.
 */
export async function embedQaAsChunk(input: {
  collectionId: string
  question: string
  answer: string
  /** Stable synthetic identifier, e.g. `ticket-resolution:<pairId>`. */
  identifier: string
  brandId?: string | null
  /** Required for the workspace-domain branch (brandId absent). */
  workspaceId?: string | null
}): Promise<{ sourceId: string; runId: string } | null> {
  const domain = input.brandId
    ? await getOrCreateBrandDomain(input.brandId)
    : input.workspaceId
      ? await getOrCreateWorkspaceDomain(input.workspaceId)
      : null
  if (!domain) return null

  const question = input.question.trim()
  const answer = input.answer.trim()
  const markdown = `## ${question}\n\n${answer}`

  try {
    const source = await db.knowledgeSource.create({
      data: {
        knowledgeDomainId: domain.id,
        collectionId: input.collectionId,
        sourceType: 'qa',
        urlOrIdentifier: input.identifier,
        crawlConfig: { markdown, title: question.slice(0, 80) },
        isActive: true,
      },
      select: { id: true },
    })
    const run = await db.ingestionRun.create({
      data: { sourceId: source.id, status: 'queued' },
      select: { id: true },
    })
    return { sourceId: source.id, runId: run.id }
  } catch {
    return null
  }
}

/** Back-compat wrapper — brand-scoped embed. */
export async function embedQaIntoBrandKnowledge(input: {
  brandId: string
  collectionId: string
  question: string
  answer: string
  identifier: string
}): Promise<{ sourceId: string; runId: string } | null> {
  return embedQaAsChunk(input)
}
