import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

type Params = { params: Promise<{ chunkId: string }> }

/**
 * PATCH /api/admin/chunks/:chunkId
 * Body: { taxonomyTags?: string[], primaryTopic?: string }
 *
 * Operator-driven taxonomy correction for chunks the LLM classifier
 * couldn't place automatically. Used by the "_other bucket" UI on
 * the knowledge-sources page — operators pick from the domain's
 * existing taxonomy or create new keys, and the chunk gets retagged
 * without re-running the whole classifier.
 *
 * Workspace-membership gated.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { chunkId } = await params
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const chunk = await (db as any).knowledgeChunk.findUnique({
    where: { id: chunkId },
    include: { domain: { select: { workspaceId: true } } },
  })
  if (!chunk) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId: chunk.domain.workspaceId } },
    select: { role: true },
  })
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const data: any = {}

  if (Array.isArray(body.taxonomyTags)) {
    // Validate every tag against the domain's existing taxonomy so
    // operators can't accidentally introduce a typo'd key the
    // classifier won't reproduce next time. Cross-check with aliases
    // so "Workflow" gets accepted as "workflows" automatically.
    const taxonomies: Array<{ key: string; aliases: string[] }> =
      await (db as any).taxonomy.findMany({
        where: { knowledgeDomainId: chunk.knowledgeDomainId },
        select: { key: true, aliases: true },
      })
    const validKeys = new Set<string>()
    const aliasToKey = new Map<string, string>()
    for (const t of taxonomies) {
      validKeys.add(t.key)
      for (const alias of t.aliases) aliasToKey.set(alias.toLowerCase(), t.key)
    }

    const cleaned: string[] = []
    for (const raw of body.taxonomyTags) {
      if (typeof raw !== 'string') continue
      const lower = raw.trim().toLowerCase()
      if (validKeys.has(lower)) {
        if (!cleaned.includes(lower)) cleaned.push(lower)
      } else if (aliasToKey.has(lower)) {
        const mapped = aliasToKey.get(lower)!
        if (!cleaned.includes(mapped)) cleaned.push(mapped)
      }
      // Unknown keys silently dropped — surfaces in the UI as "not
      // saved" (the response returns the validated set).
    }
    data.taxonomyTags = cleaned
  }

  if (typeof body.primaryTopic === 'string') {
    data.primaryTopic = body.primaryTopic.trim().slice(0, 120) || null
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const updated = await (db as any).knowledgeChunk.update({
    where: { id: chunkId },
    data,
    select: {
      id: true, taxonomyTags: true, primaryTopic: true, knowledgeDomainId: true,
    },
  })
  return NextResponse.json({ chunk: updated })
}
