import { NextRequest, NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'

type Params = { params: Promise<{ sourceId: string }> }

/**
 * PATCH { action: 'recheck' } — queue a fresh ingestion run.
 * DELETE — remove the source (cascades chunks + runs).
 *
 * Both verify the source lives in a brand domain the portal user is
 * assigned to — portal users can never touch workspace-level sources.
 */
async function loadGuardedSource(sourceId: string, brandIds: string[]) {
  const source = await db.knowledgeSource.findUnique({
    where: { id: sourceId },
    select: { id: true, domain: { select: { brandId: true } } },
  }).catch(() => null)
  if (!source?.domain.brandId || !brandIds.includes(source.domain.brandId)) return null
  return source
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { sourceId } = await params

  const source = await loadGuardedSource(sourceId, session.brandIds)
  if (!source) return NextResponse.json({ error: 'Source not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (body.action !== 'recheck') {
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
  }

  const pending = await db.ingestionRun.findFirst({
    where: { sourceId: source.id, status: { in: ['queued', 'running'] } },
    select: { id: true },
  })
  const run =
    pending ?? (await db.ingestionRun.create({ data: { sourceId: source.id, status: 'queued' }, select: { id: true } }))
  return NextResponse.json({ runId: run.id, alreadyRunning: !!pending })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { sourceId } = await params

  const source = await loadGuardedSource(sourceId, session.brandIds)
  if (!source) return NextResponse.json({ error: 'Source not found' }, { status: 404 })

  await db.knowledgeSource.delete({ where: { id: source.id } })
  return NextResponse.json({ ok: true })
}
