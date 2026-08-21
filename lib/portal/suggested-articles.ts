/**
 * Suggested help-center articles for a portal agent handling a live chat.
 *
 * Builds a retrieval query from the visitor's questions in THIS session plus
 * recent questions from their PAST sessions on the same brand, then pulls the
 * best-matching chunks from the brand's own knowledge (help-center articles,
 * uploaded docs, learned answers). Brand-scoped: never surfaces another
 * brand's knowledge. Best-effort — returns [] on any miss so the page always
 * renders.
 */

import { db } from '@/lib/db'
import { retrieveChunks } from '@/lib/ingest/retrieve'
import { findBrandCollectionId } from '@/lib/ingest/brand-domain'
import { summariseRetrievedChunks, type KnowledgeUsedItem } from '@/lib/agent/retrieve-for-agent'

const VISITOR_ROLES = ['visitor', 'user', 'contact']

export async function getSuggestedArticles(input: {
  brandId: string
  workspaceId: string
  visitorId?: string | null
  currentConversationId: string
  currentMessages: Array<{ role: string; content: string }>
}): Promise<KnowledgeUsedItem[]> {
  try {
    const currentQs = input.currentMessages
      .filter(m => VISITOR_ROLES.includes(m.role))
      .map(m => m.content)

    let pastQs: string[] = []
    if (input.visitorId) {
      const past = await db.widgetMessage.findMany({
        where: {
          conversation: { visitorId: input.visitorId, id: { not: input.currentConversationId } },
          role: { in: VISITOR_ROLES },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { content: true },
      }).catch(() => [])
      pastQs = past.map(p => p.content)
    }

    const query = [...currentQs.slice(-8), ...pastQs.slice(0, 6)]
      .map(s => (s || '').trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000)
    if (query.trim().length < 3) return []

    // Scope strictly to the brand's own collection — a whitelabel portal must
    // never show another brand's knowledge.
    const brandCollectionId = await findBrandCollectionId(input.brandId)
    if (!brandCollectionId) return []

    const chunks = await retrieveChunks(input.workspaceId, query, {
      limit: 5,
      collectionIds: [brandCollectionId],
      scopeToCollections: true,
    })

    const seen = new Set<string>()
    return summariseRetrievedChunks(chunks).filter(a => {
      const key = a.sourceUrl || a.title
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  } catch {
    return []
  }
}
