import { NextRequest, NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'

/**
 * GET ?brandId= — the brand's knowledge sources with latest run state and
 * live chunk counts. Polled by the portal Knowledge page while ingestion
 * runs in the background.
 */
export async function GET(req: NextRequest) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = req.nextUrl.searchParams.get('brandId') ?? ''
  if (!brandId || !session.brandIds.includes(brandId)) {
    return NextResponse.json({ error: 'Unknown brand' }, { status: 403 })
  }

  try {
    const domain = await db.knowledgeDomain.findUnique({
      where: { brandId },
      select: { id: true },
    })
    if (!domain) return NextResponse.json({ sources: [] })

    const sources = await db.knowledgeSource.findMany({
      where: { knowledgeDomainId: domain.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        sourceType: true,
        urlOrIdentifier: true,
        crawlConfig: true,
        isActive: true,
        lastCrawledAt: true,
        createdAt: true,
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 1,
          select: {
            status: true, startedAt: true, completedAt: true,
            pagesSucceeded: true, chunksCreated: true,
          },
        },
        _count: { select: { chunks: { where: { supersededAt: null } } } },
      },
    })

    return NextResponse.json({
      sources: sources.map(s => ({
        id: s.id,
        sourceType: s.sourceType,
        // Show the original filename for uploads, the URL for everything else.
        label:
          (s.crawlConfig as { originalFilename?: string } | null)?.originalFilename
          ?? s.urlOrIdentifier,
        isActive: s.isActive,
        lastCrawledAt: s.lastCrawledAt,
        createdAt: s.createdAt,
        latestRun: s.runs[0] ?? null,
        chunkCount: s._count.chunks,
      })),
    })
  } catch {
    // Pre-migration: brandId column missing.
    return NextResponse.json({ sources: [] })
  }
}
