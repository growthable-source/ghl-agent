import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

type Params = { params: Promise<{ setId: string }> }

async function memberAccess(setId: string) {
  const session = await auth()
  if (!session?.user?.id) return null
  const set = await (db as any).retrievalEvalSet.findUnique({
    where: { id: setId },
    select: { workspaceId: true },
  })
  if (!set) return null
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: set.workspaceId } },
    select: { role: true },
  })
  return member ? { session, workspaceId: set.workspaceId } : null
}

/**
 * POST /api/admin/retrieval-evals/sets/:setId/queries
 * Body: { query, expectedAnswer, brandId?, intentTags? }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { setId } = await params
  const access = await memberAccess(setId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const { query, expectedAnswer, brandId, intentTags } = body
  if (!query || !expectedAnswer) {
    return NextResponse.json({ error: 'query + expectedAnswer required' }, { status: 400 })
  }

  // Cross-workspace brand check
  if (brandId) {
    const brand = await db.brand.findFirst({
      where: { id: brandId, workspaceId: access.workspaceId },
      select: { id: true },
    })
    if (!brand) return NextResponse.json({ error: 'brandId not in this workspace' }, { status: 400 })
  }

  const q = await (db as any).retrievalEvalQuery.create({
    data: {
      evalSetId: setId,
      query: String(query).slice(0, 1000),
      expectedAnswer: String(expectedAnswer).slice(0, 4000),
      brandId: brandId ?? null,
      intentTags: Array.isArray(intentTags)
        ? intentTags.filter((t: unknown) => typeof t === 'string').slice(0, 8)
        : [],
    },
  })
  return NextResponse.json({ query: q })
}

/**
 * DELETE /api/admin/retrieval-evals/sets/:setId/queries
 * Body: { queryId }
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  const { setId } = await params
  const access = await memberAccess(setId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const queryId = body?.queryId
  if (!queryId) return NextResponse.json({ error: 'queryId required' }, { status: 400 })

  // Scope: query must belong to the set we authorised on.
  const q = await (db as any).retrievalEvalQuery.findFirst({
    where: { id: queryId, evalSetId: setId },
    select: { id: true },
  })
  if (!q) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await (db as any).retrievalEvalQuery.delete({ where: { id: queryId } })
  return NextResponse.json({ ok: true })
}
