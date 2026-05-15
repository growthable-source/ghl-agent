import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { applyLabel } from '@/lib/ingest/eval-runner'

type Params = { params: Promise<{ resultId: string }> }

/**
 * PUT /api/admin/retrieval-evals/results/:resultId/labels
 * Body: { chunkId, label: 'helpful'|'neutral'|'harmful'|null, reason? }
 *
 * Apply or clear a single label. Recomputes net@K / coverage@K on
 * the result and rolls up the run summary in the same transaction
 * so the operator's score moves the moment they click.
 */
export async function PUT(req: NextRequest, { params }: Params) {
  const { resultId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const result = await (db as any).retrievalEvalResult.findUnique({
    where: { id: resultId },
    include: { run: { include: { evalSet: { select: { workspaceId: true } } } } },
  })
  if (!result) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: result.run.evalSet.workspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { chunkId, label, reason } = body
  if (!chunkId) return NextResponse.json({ error: 'chunkId required' }, { status: 400 })
  if (label !== null && !['helpful', 'neutral', 'harmful'].includes(label)) {
    return NextResponse.json({ error: 'label must be helpful | neutral | harmful | null' }, { status: 400 })
  }

  await applyLabel(
    resultId,
    String(chunkId),
    label,
    typeof reason === 'string' ? reason.slice(0, 240) : null,
    session.user.id,
  )

  // Return the updated result so the UI doesn't have to round-trip.
  const updated = await (db as any).retrievalEvalResult.findUnique({
    where: { id: resultId },
    select: { labels: true, netAtK: true, coverageAtK: true },
  })
  return NextResponse.json(updated)
}
