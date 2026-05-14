import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

type Params = { params: Promise<{ runId: string }> }

/**
 * GET /api/admin/ingestion-runs/:runId
 *
 * Lightweight single-run polling endpoint. The admin UI hits this
 * every 2s while a run is in flight so the progress bar moves and
 * the final result lands cleanly.
 *
 * Auth: workspace-member-only, same gating as the list endpoint.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { runId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let run: any
  try {
    run = await (db as any).ingestionRun.findUnique({
      where: { id: runId },
      include: {
        source: {
          select: {
            id: true, sourceType: true, urlOrIdentifier: true,
            domain: { select: { workspaceId: true } },
          },
        },
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'migration_pending' }, { status: 503 })
    }
    throw err
  }
  if (!run) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: run.source.domain.workspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  return NextResponse.json({
    id: run.id,
    sourceId: run.sourceId,
    source: { id: run.source.id, sourceType: run.source.sourceType, urlOrIdentifier: run.source.urlOrIdentifier },
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    status: run.status,
    pagesAttempted: run.pagesAttempted,
    pagesSucceeded: run.pagesSucceeded,
    chunksCreated: run.chunksCreated,
    chunksSuperseded: run.chunksSuperseded,
    errorLog: run.errorLog ?? [],
  })
}
