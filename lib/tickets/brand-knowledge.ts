/**
 * Brand-agent learning from released ticket replies.
 *
 * Two steps, mirroring the conversation-mining review flow:
 *
 *   stageTicketResolutionLearning()  — on approve-&-send, distil the exchange
 *     into a Q&A and STAGE it as a MinedQaPair on the brand's collection
 *     (source='ticket_approval'). Human-gated: nothing reaches an agent yet.
 *
 *   embedQaIntoBrandKnowledge()      — when an operator approves that pair in
 *     the Mined Q&A tab, embed the Q&A as a KnowledgeChunk in the brand's
 *     KnowledgeDomain (via the 'qa' ingest adapter). Both the widget chat and
 *     ticket suggest-reply retrieve chunks over that domain, so the learning
 *     improves both — which a KnowledgeEntry would not (suggest-reply reads
 *     chunks only).
 *
 * Both are the seam a future rating signal plugs into: a positively-rated
 * resolution can call stageTicketResolutionLearning the same way.
 *
 * Every path is failure-tolerant: staging must never break the approval or
 * the customer email, so it swallows to null on any error (incl. pre-migration
 * DBs missing the new columns).
 */

import { db } from '@/lib/db'
import { getOrCreateBrandCollection, getOrCreateBrandDomain } from '@/lib/ingest/brand-domain'
import { distillResolutionToQa } from './resolution-to-qa'

export async function stageTicketResolutionLearning(input: {
  ticket: { id: string; brandId: string | null; workspaceId: string }
  question: string
  answer: string
  brandName?: string | null
}): Promise<{ pairId: string; distilled: boolean } | null> {
  const { ticket } = input
  // No brand → no brand collection → nowhere brand-scoped to learn into.
  if (!ticket.brandId) return null
  if (!input.question.trim() || !input.answer.trim()) return null

  try {
    const collection = await getOrCreateBrandCollection(ticket.brandId)
    if (!collection) return null

    const qa = await distillResolutionToQa({
      question: input.question,
      reply: input.answer,
      brandName: input.brandName,
    })

    // Light dedup: don't re-stage an identical question already awaiting or
    // approved for this brand. Cross-phrasing dupes are caught by the human
    // reviewer.
    const existing = await db.minedQaPair.findFirst({
      where: { collectionId: collection.id, question: qa.question, status: { in: ['pending', 'approved'] } },
      select: { id: true },
    })
    if (existing) return { pairId: existing.id, distilled: qa.distilled }

    const pair = await db.minedQaPair.create({
      data: {
        workspaceId: ticket.workspaceId,
        collectionId: collection.id,
        source: 'ticket_approval',
        sourceTicketId: ticket.id,
        question: qa.question,
        answer: qa.answer,
        confidence: qa.confidence,
        status: 'pending',
      },
      select: { id: true },
    })
    return { pairId: pair.id, distilled: qa.distilled }
  } catch {
    // Pre-migration (source/sourceTicketId columns missing) or transient —
    // learning is best-effort and must never surface to the reviewer.
    return null
  }
}

/**
 * Queue a Q&A pair for embedding into the brand's knowledge domain. Returns
 * the created source + run, or null if the brand has no domain yet or the
 * write fails. The ingest-queue cron does the actual chunk/embed shortly
 * after — the chunk is retrievable once that run completes.
 */
export async function embedQaIntoBrandKnowledge(input: {
  brandId: string
  collectionId: string
  question: string
  answer: string
  /** Stable synthetic identifier, e.g. `ticket-resolution:<pairId>`. */
  identifier: string
}): Promise<{ sourceId: string; runId: string } | null> {
  const domain = await getOrCreateBrandDomain(input.brandId)
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
