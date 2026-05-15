import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

type Params = { params: Promise<{ runId: string }> }

/**
 * GET /api/admin/retrieval-evals/runs/:runId
 *
 * Returns the full run detail — header + per-query results with
 * labels — so the UI can render the labeling pane and the summary
 * card from one fetch. Also serves as the polling endpoint during
 * a running execution; status='running' clients re-poll every 2s.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { runId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const run = await (db as any).retrievalEvalRun.findUnique({
    where: { id: runId },
    include: {
      evalSet: { select: { workspaceId: true, name: true } },
      results: {
        include: {
          query: {
            include: { brand: { select: { id: true, name: true, slug: true } } },
          },
        },
        orderBy: { query: { createdAt: 'asc' } } as any,
      },
    },
  })
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: run.evalSet.workspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  return NextResponse.json({
    id: run.id,
    evalSetId: run.evalSetId,
    evalSetName: run.evalSet.name,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    status: run.status,
    config: run.config,
    rubricVersion: run.rubricVersion,
    summary: run.summary,
    results: run.results.map((r: any) => ({
      id: r.id,
      query: {
        id: r.query.id,
        query: r.query.query,
        expectedAnswer: r.query.expectedAnswer,
        brand: r.query.brand,
        intentTags: r.query.intentTags,
      },
      retrievedChunks: r.retrievedChunks,
      labels: r.labels,
      netAtK: r.netAtK,
      coverageAtK: r.coverageAtK,
    })),
  })
}
