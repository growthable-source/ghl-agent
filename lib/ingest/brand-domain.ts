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

/**
 * Wire a brand's portal-knowledge collection into the agent(s) that
 * actually answer that brand's chat.
 *
 * Why this exists: portal users add knowledge into the brand collection,
 * but a provisioned brand agent runs knowledgeScopeAll:false (scoped) — it
 * retrieves ONLY collections explicitly attached via AgentCollection (the
 * canonical corpus + crawled help-center articles, see lib/partner/
 * article-sync.ts). Without this link the brand's own portal knowledge is
 * orphaned: the Knowledge page shows the collection "not connected" and
 * the widget never reads it. (Workspace-wide agents — knowledgeScopeAll:
 * true — already pick it up; the scoped/provisioned agents are the gap.)
 *
 * We attach to the agent behind each of the brand's widgets —
 * ChatWidget.defaultAgentId, the same agent lib/widget-agent-runner.ts
 * resolves — but ONLY when that id points at a live, active agent in the
 * widget's workspace (the runner's own gate). defaultAgentId has no
 * foreign key, so it can be stale (point at a deleted agent), whereas
 * AgentCollection.agentId DOES have an FK — attaching to a ghost id would
 * throw a constraint error. A widget with a null or dead defaultAgentId
 * routes to a fallback agent, which is workspace-wide and already reads
 * the collection, so there's nothing to attach there.
 *
 * Idempotent (upsert on the AgentCollection unique) and meant to be
 * called best-effort: a throw must never fail the portal add that
 * triggered it — teaching the AI can't break over a wiring nicety.
 */
export async function attachBrandCollectionToAgents(
  brandId: string,
  collectionId: string,
): Promise<number> {
  const widgets = await db.chatWidget.findMany({
    where: { brandId, defaultAgentId: { not: null } },
    select: { defaultAgentId: true, workspaceId: true },
  })
  if (widgets.length === 0) return 0

  // defaultAgentId has no FK and can be stale, so resolve which referenced
  // agents actually exist, are active, and live in the widget's workspace
  // — the same gate widget-agent-runner applies — before attaching. This
  // keeps us off deleted agents (AgentCollection.agentId would violate its
  // FK) and off agents the widget wouldn't actually use.
  const ids = [...new Set(widgets.map(w => w.defaultAgentId!).filter(Boolean))]
  const live = await db.agent.findMany({
    where: { id: { in: ids }, isActive: true },
    select: { id: true, workspaceId: true },
  })
  const workspaceById = new Map(live.map(a => [a.id, a.workspaceId]))

  const agentIds = [...new Set(
    widgets
      .filter(w => workspaceById.get(w.defaultAgentId!) === w.workspaceId)
      .map(w => w.defaultAgentId!),
  )]
  for (const agentId of agentIds) {
    await db.agentCollection.upsert({
      where: { agentId_collectionId: { agentId, collectionId } },
      create: { agentId, collectionId },
      update: {},
    })
  }
  return agentIds.length
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
