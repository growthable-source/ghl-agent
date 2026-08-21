import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createKnowledgeInCollection } from '@/lib/knowledge'
import { estimateTokens } from '@/lib/chunker'
import { embedQaIntoBrandKnowledge } from '@/lib/tickets/brand-knowledge'

type Params = { params: Promise<{ workspaceId: string; collectionId: string; pairId: string }> }

/**
 * PATCH — act on a staged mined Q&A pair.
 * Body: { action: 'approve' | 'reject', question?, answer? }
 *
 * Approve promotes the (optionally edited) pair into a live KnowledgeEntry
 * with source='qa', matching the manual Q&A format exactly:
 *   title   = question (≤80 chars)
 *   content = "Q: <question>\nA: <answer>"
 * so the agent reads mined and hand-authored pairs identically.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId, pairId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const pair = await db.minedQaPair.findFirst({
    where: { id: pairId, collectionId, workspaceId },
  })
  if (!pair) return NextResponse.json({ error: 'Pair not found' }, { status: 404 })
  if (pair.status !== 'pending') {
    return NextResponse.json({ error: `Pair already ${pair.status}` }, { status: 409 })
  }

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const action = body.action
  const question = typeof body.question === 'string' && body.question.trim() ? body.question.trim() : pair.question
  const answer = typeof body.answer === 'string' && body.answer.trim() ? body.answer.trim() : pair.answer

  if (action === 'reject') {
    await db.minedQaPair.update({ where: { id: pairId }, data: { status: 'rejected' } })
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  if (action === 'approve') {
    // Ticket-approval learnings must reach the ticket suggest-reply path,
    // which retrieves CHUNKS only (never KnowledgeEntry rows). So embed the
    // pair into the brand's knowledge domain instead of creating a
    // prompt-stuffed-only entry; the ingest cron chunks + embeds it shortly
    // after, and both the widget chat and suggest-reply then retrieve it.
    if (pair.source === 'ticket_approval') {
      const collection = await db.knowledgeCollection
        .findUnique({ where: { id: collectionId }, select: { brandId: true } })
        .catch(() => null)
      if (collection?.brandId) {
        const embedded = await embedQaIntoBrandKnowledge({
          brandId: collection.brandId,
          collectionId,
          question,
          answer,
          identifier: `ticket-resolution:${pair.id}`,
        })
        // Only consume the pair once it's actually queued for embedding.
        // If embedding failed (missing brand / transient DB error) leave it
        // pending so the operator can retry — otherwise the learning is lost.
        if (!embedded) {
          return NextResponse.json(
            { error: 'Could not queue this answer for embedding — please try again.' },
            { status: 503 },
          )
        }
        await db.minedQaPair.update({
          where: { id: pairId },
          data: { status: 'approved', question, answer, knowledgeSourceId: embedded.sourceId },
        })
        return NextResponse.json({ ok: true, status: 'approved', embedded: true })
      }
      // Brandless collection (shouldn't happen for ticket pairs) → fall
      // through to the standard entry promotion.
    }

    const title = question.slice(0, 80)
    const content = `Q: ${question}\nA: ${answer}`
    const entry = await createKnowledgeInCollection({
      collectionId,
      workspaceId,
      title,
      content,
      source: 'qa',
      tokenEstimate: estimateTokens(content),
    })
    await db.minedQaPair.update({
      where: { id: pairId },
      data: { status: 'approved', question, answer, knowledgeEntryId: entry.id },
    })
    return NextResponse.json({ ok: true, status: 'approved', entry })
  }

  return NextResponse.json({ error: 'action must be approve or reject' }, { status: 400 })
}

/** DELETE — discard a staged pair outright (distinct from rejecting). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, collectionId, pairId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const pair = await db.minedQaPair.findFirst({
    where: { id: pairId, collectionId, workspaceId },
    select: { id: true },
  })
  if (!pair) return NextResponse.json({ error: 'Pair not found' }, { status: 404 })

  await db.minedQaPair.delete({ where: { id: pairId } })
  return NextResponse.json({ ok: true })
}
