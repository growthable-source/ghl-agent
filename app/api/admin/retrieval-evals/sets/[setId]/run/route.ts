import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { runEval } from '@/lib/ingest/eval-runner'

type Params = { params: Promise<{ setId: string }> }

/**
 * POST /api/admin/retrieval-evals/sets/:setId/run
 *
 * Kicks off a run async. Creates the RetrievalEvalRun row up front
 * (status='running'), runs the eval in the post-response window,
 * marks 'success'/'failed' on completion. Caller polls
 * /api/admin/retrieval-evals/runs/:runId for status.
 */
export const maxDuration = 300

export async function POST(_req: NextRequest, { params }: Params) {
  const { setId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const set = await (db as any).retrievalEvalSet.findUnique({
    where: { id: setId },
    select: { workspaceId: true, _count: { select: { queries: true } } },
  })
  if (!set) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: set.workspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  if (set._count.queries === 0) {
    return NextResponse.json({ error: 'Add at least one query to the eval set before running.' }, { status: 400 })
  }

  // Check for an in-flight run on this set
  const existing = await (db as any).retrievalEvalRun.findFirst({
    where: { evalSetId: setId, status: 'running' },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ runId: existing.id, alreadyRunning: true })
  }

  // Create the run row up front so the client has a stable polling
  // target. Pass that id into runEval so it updates THIS row instead
  // of creating a new one.
  let placeholder: { id: string }
  try {
    placeholder = await (db as any).retrievalEvalRun.create({
      data: { evalSetId: setId, status: 'running', config: {}, rubricVersion: '2026-05-15.v1' },
      select: { id: true },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'failed_to_start' }, { status: 500 })
  }

  after(async () => {
    try {
      await runEval(setId, { runId: placeholder.id })
    } catch (err: any) {
      console.warn('[eval-run] background runner failed:', err?.message)
      try {
        await (db as any).retrievalEvalRun.update({
          where: { id: placeholder.id },
          data: { status: 'failed', completedAt: new Date() },
        })
      } catch { /* ignore */ }
    }
  })

  return NextResponse.json({ runId: placeholder.id })
}
