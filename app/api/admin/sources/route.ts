import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { ingestSource } from '@/lib/ingest/pipeline'

/**
 * KnowledgeSource CRUD + manual ingest trigger.
 *
 * GET  ?knowledgeDomainId=...     → list sources in this domain
 * POST { knowledgeDomainId, sourceType, urlOrIdentifier, crawlConfig? } → create
 * POST /:id/run                   → trigger an ingest immediately (in a sibling file)
 */
async function memberAccess(domainId: string) {
  const session = await auth()
  if (!session?.user?.id) return null
  const domain = await (db as any).knowledgeDomain.findUnique({
    where: { id: domainId },
    select: { workspaceId: true },
  })
  if (!domain) return null
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: domain.workspaceId } },
    select: { role: true },
  })
  return member ? { session, role: member.role } : null
}

export async function GET(req: NextRequest) {
  const knowledgeDomainId = req.nextUrl.searchParams.get('knowledgeDomainId')
  if (!knowledgeDomainId) return NextResponse.json({ error: 'knowledgeDomainId required' }, { status: 400 })
  const access = await memberAccess(knowledgeDomainId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const sources = await (db as any).knowledgeSource.findMany({
      where: { knowledgeDomainId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { chunks: { where: { supersededAt: null } } as any, runs: true } },
      },
    })
    return NextResponse.json({
      sources: sources.map((s: any) => ({
        id: s.id,
        sourceType: s.sourceType,
        urlOrIdentifier: s.urlOrIdentifier,
        crawlConfig: s.crawlConfig,
        isActive: s.isActive,
        lastCrawledAt: s.lastCrawledAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        liveChunks: s._count.chunks,
        runCount: s._count.runs,
      })),
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ sources: [], notMigrated: true })
    }
    throw err
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { knowledgeDomainId, sourceType, urlOrIdentifier, crawlConfig } = body
  if (!knowledgeDomainId || !sourceType || !urlOrIdentifier) {
    return NextResponse.json({ error: 'knowledgeDomainId, sourceType, urlOrIdentifier required' }, { status: 400 })
  }
  const access = await memberAccess(knowledgeDomainId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const allowed = new Set(['docs', 'pdf', 'youtube', 'rss', 'community', 'manual'])
  if (!allowed.has(sourceType)) {
    return NextResponse.json({ error: 'invalid sourceType' }, { status: 400 })
  }

  const source = await (db as any).knowledgeSource.create({
    data: {
      knowledgeDomainId,
      sourceType,
      urlOrIdentifier: String(urlOrIdentifier).trim().slice(0, 2000),
      crawlConfig: typeof crawlConfig === 'object' && crawlConfig !== null ? crawlConfig : {},
    },
  })
  return NextResponse.json({ source })
}
