/**
 * GET /api/workspaces/[workspaceId]/knowledge/sources
 *
 * Everything the workspace is learning from, across ALL its knowledge
 * domains, with the latest run state and live chunk counts — the
 * backing data for the simple Knowledge page's source list. One
 * endpoint so the UI never has to understand the domain → source →
 * run hierarchy.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { db } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const sources = await db.knowledgeSource.findMany({
    where: { domain: { workspaceId } },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      runs: { orderBy: { startedAt: 'desc' }, take: 1 },
    },
  })

  // Live (non-superseded) chunk counts in one grouped query.
  const counts = await db.knowledgeChunk.groupBy({
    by: ['sourceId'],
    where: { sourceId: { in: sources.map(s => s.id) }, supersededAt: null },
    _count: { _all: true },
  })
  const countBySource = new Map(counts.map(c => [c.sourceId, c._count._all]))

  return NextResponse.json({
    sources: sources.map(s => {
      const run = s.runs[0] ?? null
      const cfg = (s.crawlConfig ?? {}) as Record<string, unknown>
      return {
        id: s.id,
        sourceType: s.sourceType,
        url: s.urlOrIdentifier,
        displayName:
          (cfg.originalFilename as string) ||
          s.urlOrIdentifier.replace(/^https?:\/\//, '').replace(/\/$/, ''),
        isActive: s.isActive,
        recrawlIntervalDays: Number(cfg.recrawlIntervalDays) || 0,
        lastCrawledAt: s.lastCrawledAt ? s.lastCrawledAt.toISOString() : null,
        chunkCount: countBySource.get(s.id) ?? 0,
        latestRun: run
          ? {
              id: run.id,
              status: run.status,
              startedAt: run.startedAt ? run.startedAt.toISOString() : null,
              completedAt: run.completedAt ? run.completedAt.toISOString() : null,
              pagesAttempted: run.pagesAttempted,
              pagesSucceeded: run.pagesSucceeded,
              chunksCreated: run.chunksCreated,
              errorCount: Array.isArray(run.errorLog) ? run.errorLog.length : 0,
              // First real error message — failures must be
              // self-explanatory in the UI, not "check Vercel logs".
              firstError:
                Array.isArray(run.errorLog) && run.errorLog.length > 0
                  ? String((run.errorLog[0] as { message?: string })?.message ?? '').slice(0, 300) || null
                  : null,
            }
          : null,
      }
    }),
  })
}
