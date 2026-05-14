import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { ingestSource } from '@/lib/ingest/pipeline'

type Params = { params: Promise<{ sourceId: string }> }

/**
 * POST /api/admin/sources/:sourceId/run
 *
 * Triggers an ingest immediately. Useful for: smoke-testing a new
 * source, re-running after the operator fixed a Firecrawl rate-limit
 * issue, or pulling in fresh content ahead of the cron's interval.
 *
 * Synchronous response — returns the IngestionRun summary. Caller
 * is expected to be the admin UI; if ingest takes >60s on a big
 * source the operator sees the spinner. v2 swaps to "kick off + poll
 * the runs endpoint" once a single run runs long.
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

  try {
    const result = await ingestSource(sourceId)
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'ingest_failed' }, { status: 500 })
  }
}
