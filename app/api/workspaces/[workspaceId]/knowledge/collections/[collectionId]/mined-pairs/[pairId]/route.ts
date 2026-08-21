import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { createKnowledgeInCollection } from '@/lib/knowledge'
import { estimateTokens } from '@/lib/chunker'
import { embedQaAsChunk } from '@/lib/tickets/brand-knowledge'

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
    const collection = await db.knowledgeCollection
      .findUnique({ where: { id: collectionId }, select: { brandId: true } })
      .catch(() => null)

    // Resolution learnings (released ticket replies, highly-rated chats) must
    // reach the ticket suggest-reply path, which retrieves CHUNKS only (never
    // KnowledgeEntry rows). Embed into the brand's (or workspace's) knowledge
    // domain; the ingest cron chunks + embeds it, and both the widget chat and
    // suggest-reply then retrieve it.
    if (pair.source === 'ticket_approval' || pair.source === 'chat_csat') {
      const embedded = await embedQaAsChunk({
        collectionId,
        question,
        answer,
        identifier: `${pair.source}:${pair.id}`,
        brandId: collection?.brandId ?? null,
        workspaceId,
      })
      // Only consume the pair once it's actually queued for embedding. If it
      // failed (transient DB error) leave it pending so the operator can
      // retry — otherwise the learning is lost.
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

    // Mining / manual pairs keep their KnowledgeEntry (prompt-stuffed for the
    // widget chat) AND additionally embed a chunk (best-effort) so they also
    // reach ticket suggest-reply — closing the same loop without changing what
    // shows on the Knowledge page.
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
    // after() so Vercel keeps the runtime alive past the response — the embed
    // yields on a DB lookup before creating the source/run, and a bare
    // fire-and-forget would be torn down mid-flight.
    after(async () => {
      await embedQaAsChunk({
        collectionId,
        question,
        answer,
        identifier: `mined:${pair.id}`,
        brandId: collection?.brandId ?? null,
        workspaceId,
      }).catch(() => {})
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
