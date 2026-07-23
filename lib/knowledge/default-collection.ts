import { db } from '@/lib/db'
import { getOrCreateWorkspaceDomain } from '@/lib/ingest/workspace-domain'

/**
 * The collection new knowledge lands in when the operator didn't pick one.
 *
 * Collections are the single container in the knowledge model: a
 * collection holds written entries (stuffed into the prompt), live
 * sources (crawled → chunked → retrieved), and data-source tools.
 * Agents attach collections and nothing else.
 *
 * `KnowledgeDomain` still exists underneath as the storage anchor for
 * chunks, but it is invisible — every source gets the workspace's one
 * auto domain, and grouping happens purely at the collection layer.
 */

const DEFAULT_COLLECTION_NAME = 'General knowledge'

export async function getOrCreateDefaultCollection(workspaceId: string): Promise<{ id: string }> {
  const existing = await db.knowledgeCollection.findFirst({
    where: { workspaceId, name: DEFAULT_COLLECTION_NAME },
    select: { id: true },
  })
  if (existing) return existing

  // Reuse ANY existing collection before creating a second one — a
  // workspace that already organised its knowledge shouldn't grow a
  // stray "General knowledge" bucket the first time someone pastes a
  // link into the top-level box.
  const any = await db.knowledgeCollection.findFirst({
    where: { workspaceId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  if (any) return any

  return db.knowledgeCollection.create({
    data: {
      workspaceId,
      name: DEFAULT_COLLECTION_NAME,
      description: 'Everything added from the Knowledge page. Agents read this by default.',
      icon: '📚',
      color: '#fa4d2e',
    },
    select: { id: true },
  })
}

/**
 * Resolve the (collectionId, knowledgeDomainId) pair a new source
 * should be created with. Callers pass the operator's chosen
 * collection if there is one; otherwise it falls back to the default.
 *
 * Returns null when the requested collection isn't in this workspace,
 * so the caller can 400 rather than silently writing elsewhere.
 */
export async function resolveIngestTarget(
  workspaceId: string,
  requestedCollectionId?: string | null,
): Promise<{ collectionId: string; knowledgeDomainId: string } | null> {
  let collectionId: string
  if (requestedCollectionId) {
    const found = await db.knowledgeCollection.findFirst({
      where: { id: requestedCollectionId, workspaceId },
      select: { id: true },
    })
    if (!found) return null
    collectionId = found.id
  } else {
    collectionId = (await getOrCreateDefaultCollection(workspaceId)).id
  }

  const domain = await getOrCreateWorkspaceDomain(workspaceId)
  return { collectionId, knowledgeDomainId: domain.id }
}
