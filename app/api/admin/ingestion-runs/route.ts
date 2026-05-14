import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

/**
 * Ingestion-run feed for the admin viewer. Filterable by source.
 * Returns the run header + parsed error_log; drill-down to a single
 * run shows the same payload.
 */
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const sourceId = req.nextUrl.searchParams.get('sourceId')
  const knowledgeDomainId = req.nextUrl.searchParams.get('knowledgeDomainId')

  // Scope by either source OR domain. Both narrow to a workspace; we
  // resolve the workspace from whichever scope was given and gate on
  // membership before serving.
  let workspaceId: string | null = null
  if (sourceId) {
    const s = await (db as any).knowledgeSource.findUnique({
      where: { id: sourceId },
      select: { knowledgeDomainId: true, domain: { select: { workspaceId: true } } },
    })
    workspaceId = s?.domain?.workspaceId ?? null
  } else if (knowledgeDomainId) {
    const d = await (db as any).knowledgeDomain.findUnique({
      where: { id: knowledgeDomainId },
      select: { workspaceId: true },
    })
    workspaceId = d?.workspaceId ?? null
  }
  if (!workspaceId) return NextResponse.json({ error: 'sourceId or knowledgeDomainId required' }, { status: 400 })

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const where: any = sourceId
      ? { sourceId }
      : { source: { knowledgeDomainId } }
    const runs = await (db as any).ingestionRun.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 100,
      include: {
        source: { select: { id: true, sourceType: true, urlOrIdentifier: true } },
      },
    })
    return NextResponse.json({
      runs: runs.map((r: any) => ({
        id: r.id,
        sourceId: r.sourceId,
        source: r.source,
        startedAt: r.startedAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
        status: r.status,
        pagesAttempted: r.pagesAttempted,
        pagesSucceeded: r.pagesSucceeded,
        chunksCreated: r.chunksCreated,
        chunksSuperseded: r.chunksSuperseded,
        errorLog: r.errorLog ?? [],
      })),
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ runs: [], notMigrated: true })
    }
    throw err
  }
}
