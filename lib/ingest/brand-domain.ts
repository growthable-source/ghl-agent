/**
 * Brand-scoped knowledge domain — the portal's knowledge container.
 *
 * Portal users add sources (links / files) for THEIR brand without ever
 * seeing the "domain" concept, mirroring getOrCreateWorkspaceDomain for
 * the dashboard's simple flow. One domain per brand (KnowledgeDomain.brandId
 * is unique); it lives in the brand's workspace so workspace-wide retrieval
 * picks it up automatically, and the ticket suggest-reply path targets it
 * explicitly by brand.
 *
 * The name embeds the brand slug (unique per workspace) so the
 * @@unique([workspaceId, name]) constraint can't collide when two brands
 * share a display name.
 */

import { db } from '@/lib/db'

export async function getOrCreateBrandDomain(
  brandId: string,
): Promise<{ id: string; workspaceId: string } | null> {
  const existing = await db.knowledgeDomain.findUnique({
    where: { brandId },
    select: { id: true, workspaceId: true },
  })
  if (existing) return existing

  const brand = await db.brand.findUnique({
    where: { id: brandId },
    select: { workspaceId: true, name: true, slug: true },
  })
  if (!brand) return null

  return db.knowledgeDomain.create({
    data: {
      workspaceId: brand.workspaceId,
      brandId,
      name: `${brand.name} — portal knowledge (${brand.slug})`,
      description: 'Added by portal users for this brand. Used when drafting ticket replies and by workspace-wide agents.',
    },
    select: { id: true, workspaceId: true },
  })
}

/** Read-only lookup — used by suggest-reply, which must never create rows. */
export async function findBrandDomainId(brandId: string | null | undefined): Promise<string | null> {
  if (!brandId) return null
  const domain = await db.knowledgeDomain.findUnique({
    where: { brandId },
    select: { id: true },
  }).catch(() => null) // pre-migration: brandId column missing
  return domain?.id ?? null
}

/**
 * The COLLECTION portal-added brand knowledge belongs to. Collections
 * are the only container operators and agents see, so brand knowledge
 * needs one too — otherwise it's invisible on the Knowledge page and
 * unattachable to an agent.
 *
 * One per brand, matched on KnowledgeCollection.brandId.
 */
export async function getOrCreateBrandCollection(
  brandId: string,
): Promise<{ id: string; workspaceId: string } | null> {
  const existing = await db.knowledgeCollection.findFirst({
    where: { brandId },
    select: { id: true, workspaceId: true },
  }).catch(() => null)
  if (existing) return existing

  const brand = await db.brand.findUnique({
    where: { id: brandId },
    select: { workspaceId: true, name: true },
  })
  if (!brand) return null

  return db.knowledgeCollection.create({
    data: {
      workspaceId: brand.workspaceId,
      brandId,
      name: `${brand.name} — portal knowledge`,
      description: 'Added by portal users for this brand. Used when drafting ticket replies and by any agent this collection is attached to.',
      icon: '🏷️',
    },
    select: { id: true, workspaceId: true },
  })
}

/** Read-only variant for the suggest-reply path. */
export async function findBrandCollectionId(brandId: string | null | undefined): Promise<string | null> {
  if (!brandId) return null
  const c = await db.knowledgeCollection.findFirst({
    where: { brandId },
    select: { id: true },
  }).catch(() => null)
  return c?.id ?? null
}
