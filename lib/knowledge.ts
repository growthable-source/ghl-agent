/**
 * Knowledge Collections runtime helpers.
 *
 * The user-facing model: every workspace has Knowledge Collections.
 * A collection is a named bundle of items — text entries, file uploads,
 * URL crawls, FAQs, Notion pages, YouTube transcripts, AND data
 * sources (Sheets / Airtable / REST). Agents attach to one or more
 * collections; the prompt builder pulls every item from every attached
 * collection at runtime.
 *
 * This file replaces the old per-entry attachment helpers with a
 * collection-aware API. The old AgentKnowledge junction is gone —
 * AgentCollection is the single source of truth.
 */

import { db } from './db'

/**
 * Resolve the workspaceId for a given agent. Falls back through the
 * agent's location relation when agent.workspaceId is null on legacy
 * rows. Returns null if the agent doesn't exist or has no workspace.
 */
export async function resolveWorkspaceIdForAgent(agentId: string): Promise<string | null> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      workspaceId: true,
      location: { select: { workspaceId: true } },
    },
  })
  if (!agent) return null
  return agent.workspaceId ?? agent.location?.workspaceId ?? null
}

/**
 * Resolve a workspace's "default" collection — created at migration
 * time, or auto-created on first knowledge write if missing. Used
 * by the legacy per-agent create endpoints so that uploads/imports
 * still land somewhere sensible without forcing the operator to
 * pick a collection up front.
 */
export async function getOrCreateDefaultCollection(workspaceId: string): Promise<string> {
  // Migration creates a deterministic id for the default collection so
  // we can find it without a scan. If the migration ran, this returns
  // immediately; if not, we fall back to "first by order" / create.
  const deterministicId = `col_default_${hash20(workspaceId)}`
  const existing = await db.knowledgeCollection.findUnique({
    where: { id: deterministicId },
    select: { id: true },
  }).catch(() => null)
  if (existing) return existing.id

  const fallback = await db.knowledgeCollection.findFirst({
    where: { workspaceId },
    orderBy: { order: 'asc' },
    select: { id: true },
  }).catch(() => null)
  if (fallback) return fallback.id

  // No collection exists yet — create the General default. (This path
  // matters for fresh workspaces that haven't run the migration's
  // backfill INSERT, e.g. workspaces created after the migration.)
  const created = await db.knowledgeCollection.create({
    data: {
      id: deterministicId,
      workspaceId,
      name: 'General',
      description: 'Default collection. Rename or split as your library grows.',
      icon: '📚',
      order: 0,
    },
  })
  return created.id
}

function hash20(s: string): string {
  // Mirror the SQL: substr(md5(workspaceId), 1, 20)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require('node:crypto')
  return (createHash('md5').update(s).digest('hex') as string).slice(0, 20)
}

export interface CreateKnowledgeForAgentInput {
  agentId: string
  title: string
  content: string
  source?: string
  sourceUrl?: string | null
  tokenEstimate?: number
  status?: string
  contentHash?: string | null
}

/**
 * Legacy entry point — historical "create knowledge for an agent"
 * call sites (correction promotion, agent clone) still funnel through
 * here. We resolve the agent's workspace, find/auto-create the
 * default collection, drop the entry into it, and ensure the agent
 * is attached to that collection so the new entry shows up in the
 * agent's prompt context immediately.
 */
export async function createKnowledgeForAgent(input: CreateKnowledgeForAgentInput) {
  const workspaceId = await resolveWorkspaceIdForAgent(input.agentId)
  if (!workspaceId) {
    throw new Error(`Agent ${input.agentId} has no workspace — cannot create knowledge.`)
  }
  const collectionId = await getOrCreateDefaultCollection(workspaceId)
  await ensureAgentAttachedToCollection(input.agentId, collectionId)
  return db.knowledgeEntry.create({
    data: {
      collectionId,
      workspaceId,
      agentId: input.agentId,
      title: input.title,
      content: input.content,
      source: input.source ?? 'manual',
      sourceUrl: input.sourceUrl ?? null,
      tokenEstimate: input.tokenEstimate ?? 0,
      status: input.status ?? 'ready',
      contentHash: input.contentHash ?? null,
    },
  })
}

/**
 * Create a knowledge entry directly inside a specific collection. Used
 * by the new workspace-level create endpoints (the operator picks the
 * collection in the UI before writing/importing).
 */
export interface CreateKnowledgeInCollectionInput {
  collectionId: string
  workspaceId: string
  title: string
  content: string
  source?: string
  sourceUrl?: string | null
  tokenEstimate?: number
  status?: string
  contentHash?: string | null
  // Optional creator-agent breadcrumb when the entry is created from
  // an agent's perspective (e.g. inline correction promotion).
  agentId?: string | null
}

export async function createKnowledgeInCollection(input: CreateKnowledgeInCollectionInput) {
  return db.knowledgeEntry.create({
    data: {
      collectionId: input.collectionId,
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      title: input.title,
      content: input.content,
      source: input.source ?? 'manual',
      sourceUrl: input.sourceUrl ?? null,
      tokenEstimate: input.tokenEstimate ?? 0,
      status: input.status ?? 'ready',
      contentHash: input.contentHash ?? null,
    },
  })
}

export async function ensureAgentAttachedToCollection(agentId: string, collectionId: string): Promise<void> {
  await db.agentCollection.upsert({
    where: { agentId_collectionId: { agentId, collectionId } },
    create: { agentId, collectionId },
    update: {},
  }).catch(() => {})
}

/**
 * Bulk-load every knowledge entry currently attached to each agent
 * (via the AgentCollection → KnowledgeCollection → KnowledgeEntry
 * chain). One DB round-trip; returns Map<agentId, KnowledgeEntry[]>
 * so callers can splice into the legacy `agent.knowledgeEntries`
 * shape without restructuring downstream code.
 *
 * Falls back gracefully when the collections migration hasn't run
 * yet — empty maps everywhere, but no thrown errors.
 */
export async function bulkLoadKnowledgeForAgents(
  agentIds: string[],
): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>()
  if (agentIds.length === 0) return out
  for (const id of agentIds) out.set(id, [])
  try {
    const rows: any[] = await db.agentCollection.findMany({
      where: { agentId: { in: agentIds } },
      include: {
        collection: {
          include: {
            entries: { where: { status: 'ready' } },
          },
        },
      },
    })
    for (const r of rows) {
      const list = out.get(r.agentId) ?? []
      for (const entry of r.collection?.entries ?? []) list.push(entry)
      out.set(r.agentId, list)
    }
  } catch (err: any) {
    // Migration pending — collections table doesn't exist. Behave like
    // an empty knowledge surface so the agent runs without context
    // rather than crashing.
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return out
    }
    throw err
  }
  return out
}

/**
 * Bulk-load active data sources from every collection attached to
 * each agent. Mirrors bulkLoadKnowledgeForAgents but for the
 * tool-side of the collection (sheets / airtable / REST). Used by
 * the prompt builder to expose data-source tools per-agent.
 */
export async function bulkLoadDataSourcesForAgents(
  agentIds: string[],
): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>()
  if (agentIds.length === 0) return out
  for (const id of agentIds) out.set(id, [])
  try {
    const rows: any[] = await db.agentCollection.findMany({
      where: { agentId: { in: agentIds } },
      include: {
        collection: {
          include: {
            dataSources: { where: { isActive: true } },
          },
        },
      },
    })
    for (const r of rows) {
      const list = out.get(r.agentId) ?? []
      for (const ds of r.collection?.dataSources ?? []) list.push(ds)
      out.set(r.agentId, list)
    }
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return out
    }
    throw err
  }
  return out
}

export async function getAttachedCollectionsForAgent(agentId: string) {
  try {
    const rows = await db.agentCollection.findMany({
      where: { agentId },
      orderBy: { attachedAt: 'asc' },
      include: {
        collection: {
          include: {
            _count: { select: { entries: true, dataSources: true } },
          },
        },
      },
    })
    return rows.map(r => r.collection).filter(Boolean)
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return []
    }
    throw err
  }
}
