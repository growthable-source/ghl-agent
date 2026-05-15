import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

/**
 * POST /api/admin/chunks/bulk-assign
 * Body: { chunkIds: string[], taxonomyKey: string }
 *
 * Bulk version of PATCH /api/admin/chunks/:chunkId. Used by the
 * "Suggest topics" flow and the multi-select picker on the _other
 * bucket — both want to retag many chunks at once.
 *
 * Authorization rule: every chunk must belong to a domain in a
 * workspace the caller is a member of. We fold the lookup into a
 * single query for speed.
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const chunkIds: string[] = Array.isArray(body.chunkIds)
    ? body.chunkIds.filter((s: unknown): s is string => typeof s === 'string').slice(0, 500)
    : []
  const taxonomyKey: string = typeof body.taxonomyKey === 'string' ? body.taxonomyKey.trim().toLowerCase() : ''
  if (chunkIds.length === 0 || !taxonomyKey) {
    return NextResponse.json({ error: 'chunkIds and taxonomyKey required' }, { status: 400 })
  }

  // Pull every chunk + domain in one query so we can authorise in one
  // pass. We then keep only the chunks whose domain is in a workspace
  // the operator belongs to.
  const chunks = await (db as any).knowledgeChunk.findMany({
    where: { id: { in: chunkIds } },
    select: {
      id: true,
      knowledgeDomainId: true,
      taxonomyTags: true,
      domain: { select: { workspaceId: true } },
    },
  })
  if (chunks.length === 0) return NextResponse.json({ error: 'no_matching_chunks' }, { status: 404 })

  const workspaceIds = Array.from(new Set(chunks.map((c: any) => c.domain.workspaceId)))
  const memberships = await db.workspaceMember.findMany({
    where: { userId: session.user.id, workspaceId: { in: workspaceIds as string[] } },
    select: { workspaceId: true },
  })
  const allowedWorkspaces = new Set(memberships.map(m => m.workspaceId))
  const allowedChunks = chunks.filter((c: any) => allowedWorkspaces.has(c.domain.workspaceId))
  if (allowedChunks.length === 0) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // Validate the taxonomy key against every domain represented in the
  // batch. Operators sometimes hand us a key from a different domain by
  // mistake — we drop chunks where the key doesn't exist instead of
  // 4xx-ing the whole call, so partial successes still work.
  const domainIds = Array.from(new Set(allowedChunks.map((c: any) => c.knowledgeDomainId)))
  const taxonomies = await (db as any).taxonomy.findMany({
    where: { knowledgeDomainId: { in: domainIds }, key: taxonomyKey },
    select: { knowledgeDomainId: true },
  })
  const validDomains = new Set(taxonomies.map((t: any) => t.knowledgeDomainId))
  const updatable = allowedChunks.filter((c: any) => validDomains.has(c.knowledgeDomainId))
  if (updatable.length === 0) {
    return NextResponse.json({ error: `Topic "${taxonomyKey}" doesn't exist in this domain.` }, { status: 400 })
  }

  // Apply. We replace the tag list with [taxonomyKey] rather than
  // appending — the _other bucket presupposes empty tags, so any
  // operator action here is a fresh assignment, not an "also tag with".
  await (db as any).knowledgeChunk.updateMany({
    where: { id: { in: updatable.map((c: any) => c.id) } },
    data: { taxonomyTags: [taxonomyKey] },
  })

  return NextResponse.json({
    updated: updatable.length,
    skipped: chunkIds.length - updatable.length,
  })
}
