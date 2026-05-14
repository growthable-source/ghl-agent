import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

/**
 * Per-domain taxonomy CRUD + `_other` bucket review.
 *
 * GET  ?knowledgeDomainId=...                  → list taxonomy rows
 * GET  ?knowledgeDomainId=...&unmatched=1      → chunks in this domain
 *                                                that hit the _other
 *                                                bucket (empty taxonomyTags)
 * POST { knowledgeDomainId, key, label, aliases?, parentKey? } → create row
 * PATCH /:id (separate file)                   → edit/delete
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
  return member ? { session, role: member.role, workspaceId: domain.workspaceId } : null
}

export async function GET(req: NextRequest) {
  const knowledgeDomainId = req.nextUrl.searchParams.get('knowledgeDomainId')
  if (!knowledgeDomainId) return NextResponse.json({ error: 'knowledgeDomainId required' }, { status: 400 })
  const access = await memberAccess(knowledgeDomainId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const unmatched = req.nextUrl.searchParams.get('unmatched') === '1'

  try {
    if (unmatched) {
      // _other bucket = chunks classified into nothing. Cap at 100 —
      // this is a review-and-fix surface, not infinite scroll.
      const chunks = await (db as any).knowledgeChunk.findMany({
        where: { knowledgeDomainId, supersededAt: null, taxonomyTags: { isEmpty: true } },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true, primaryTopic: true, content: true, sourceUrl: true,
          sourceMetadata: true, createdAt: true,
        },
      })
      return NextResponse.json({ unmatchedChunks: chunks })
    }

    const taxonomies = await (db as any).taxonomy.findMany({
      where: { knowledgeDomainId },
      orderBy: [{ parentKey: 'asc' }, { label: 'asc' }],
    })
    return NextResponse.json({ taxonomies })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ taxonomies: [], notMigrated: true })
    }
    throw err
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { knowledgeDomainId, key, label, aliases, parentKey } = body
  if (!knowledgeDomainId || !key || !label) {
    return NextResponse.json({ error: 'knowledgeDomainId, key, label required' }, { status: 400 })
  }
  const access = await memberAccess(knowledgeDomainId)
  if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  try {
    const row = await (db as any).taxonomy.create({
      data: {
        knowledgeDomainId,
        key: String(key).trim().toLowerCase().slice(0, 60),
        label: String(label).trim().slice(0, 120),
        aliases: Array.isArray(aliases)
          ? aliases.filter((a: unknown) => typeof a === 'string').slice(0, 20)
          : [],
        parentKey: typeof parentKey === 'string' && parentKey.trim() ? parentKey.trim() : null,
      },
    })
    return NextResponse.json({ taxonomy: row })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json({ error: 'A taxonomy with that key already exists in this domain.' }, { status: 409 })
    }
    throw err
  }
}
