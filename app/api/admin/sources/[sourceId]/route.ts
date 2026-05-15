import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

type Params = { params: Promise<{ sourceId: string }> }

/**
 * PATCH /api/admin/sources/:sourceId
 * Body: { recrawlIntervalDays?: number, isActive?: boolean }
 *
 * Edit a source's recrawl cadence or pause it entirely. The hourly
 * cron at /api/cron/recrawl picks sources where
 * `lastCrawledAt + recrawlIntervalDays < now`, so this is the single
 * knob that controls how stale we let a source get.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { sourceId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const source = await (db as any).knowledgeSource.findUnique({
    where: { id: sourceId },
    include: { domain: { select: { workspaceId: true } } },
  })
  if (!source) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: source.domain.workspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const data: any = {}

  if (typeof body.recrawlIntervalDays === 'number' && body.recrawlIntervalDays >= 1 && body.recrawlIntervalDays <= 365) {
    // crawlConfig is JSON — preserve everything else (includeSubpaths,
    // excludePatterns, maxPages, language…). Only the cadence changes.
    const next = { ...(source.crawlConfig ?? {}), recrawlIntervalDays: Math.round(body.recrawlIntervalDays) }
    data.crawlConfig = next
  }

  if (typeof body.isActive === 'boolean') {
    data.isActive = body.isActive
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await (db as any).knowledgeSource.update({
    where: { id: sourceId },
    data,
    select: { id: true, crawlConfig: true, isActive: true },
  })
  return NextResponse.json({ source: updated })
}
