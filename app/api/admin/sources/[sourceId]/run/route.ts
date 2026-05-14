import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { ingestSource } from '@/lib/ingest/pipeline'

type Params = { params: Promise<{ sourceId: string }> }

/**
 * POST /api/admin/sources/:sourceId/run
 *
 * Kicks off an ingest asynchronously. Creates the IngestionRun row
 * and returns its id IMMEDIATELY so the UI can poll for progress.
 * The pipeline runs post-response via after(), up to maxDuration.
 *
 * Why async: synchronous was up to 5 min of blank spinner. Visitors
 * thought the page had hung.
 */
export const maxDuration = 300

export async function POST(_req: NextRequest, { params }: Params) {
  const { sourceId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const source = await (db as any).knowledgeSource.findUnique({
    where: { id: sourceId },
    select: { knowledgeDomainId: true, domain: { select: { workspaceId: true } } },
  })
  if (!source) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: source.domain.workspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Don't start a second concurrent run on the same source — return
  // the in-flight one's id so the UI re-attaches to its progress.
  const existing = await (db as any).ingestionRun.findFirst({
    where: { sourceId, status: 'running' },
    select: { id: true },
  })
  if (existing) {
    return NextResponse.json({ runId: existing.id, alreadyRunning: true })
  }

  const run = await (db as any).ingestionRun.create({
    data: { sourceId, status: 'running' },
    select: { id: true },
  })

  after(async () => {
    try {
      await ingestSource(sourceId, { runId: run.id })
    } catch (err: any) {
      // If the pipeline blew up before writing its own failure, mark
      // the run failed here so polling can stop.
      try {
        await (db as any).ingestionRun.update({
          where: { id: run.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorLog: [{
              url: '(pipeline)',
              stage: 'discover',
              message: err?.message ?? 'pipeline crashed',
              ts: new Date().toISOString(),
            }],
          },
        })
      } catch { /* nothing more we can do */ }
    }
  })

  return NextResponse.json({ runId: run.id })
}
