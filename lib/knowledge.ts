/**
 * Knowledge helpers shared by every "create entry" path (manual write,
 * file upload, Notion import, YouTube import, crawler, correction
 * promotion, agent clone, etc.).
 *
 * Why a helper? KnowledgeEntry is now workspace-scoped and attaches to
 * agents via the AgentKnowledge junction. Resolving the workspaceId
 * from an Agent (which may not have it set; falls back through Location)
 * + creating the matching junction row needs to happen the same way
 * everywhere. Doing it in one place stops drift between code paths.
 */

import { db } from './db'

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
 * Create a new KnowledgeEntry in the agent's workspace and immediately
 * attach the agent. Throws if the agent can't be resolved to a workspace
 * (which shouldn't happen post-migration; safer to fail loud than create
 * an orphan entry).
 */
export async function createKnowledgeForAgent(input: CreateKnowledgeForAgentInput) {
  const workspaceId = await resolveWorkspaceIdForAgent(input.agentId)
  if (!workspaceId) {
    throw new Error(`Agent ${input.agentId} has no workspace — cannot create knowledge.`)
  }
  return db.knowledgeEntry.create({
    data: {
      workspaceId,
      agentId: input.agentId,
      title: input.title,
      content: input.content,
      source: input.source ?? 'manual',
      sourceUrl: input.sourceUrl ?? null,
      tokenEstimate: input.tokenEstimate ?? 0,
      status: input.status ?? 'ready',
      contentHash: input.contentHash ?? null,
      attachments: { create: { agentId: input.agentId } },
    } as any,
  })
}

/**
 * Look up every knowledge entry currently attached to an agent — the
 * single source of truth for the prompt builder. Replaces the old
 * `agent.knowledgeEntries` (per-agent FK) reads.
 */
export async function getAttachedKnowledgeForAgent(agentId: string) {
  let rows: any[] = []
  try {
    rows = await db.agentKnowledge.findMany({
      where: { agentId },
      include: { entry: true },
      orderBy: { attachedAt: 'asc' },
    })
  } catch (err: any) {
    // Migration pending — junction table doesn't exist yet. Fall back to
    // the legacy per-agent column so prod keeps working until the
    // backfill runs.
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      const legacy = await db.knowledgeEntry.findMany({
        where: { agentId },
        orderBy: { createdAt: 'asc' },
      }).catch(() => [])
      return legacy
    }
    throw err
  }
  return rows.map(r => r.entry).filter(Boolean)
}

/**
 * Bulk-load knowledge for many agents in one query — used by the
 * routing layer where we hydrate every active agent's prompt context.
 * Returns a Map<agentId, KnowledgeEntry[]> so callers can splice it
 * into the existing `knowledgeEntries` slot without restructuring.
 *
 * Falls back to the legacy per-agent `agentId` column when the junction
 * table doesn't exist yet (migration pending).
 */
export async function bulkLoadKnowledgeForAgents(
  agentIds: string[],
): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>()
  if (agentIds.length === 0) return out
  try {
    const rows: any[] = await db.agentKnowledge.findMany({
      where: { agentId: { in: agentIds } },
      include: { entry: true },
    })
    for (const r of rows) {
      const list = out.get(r.agentId) ?? []
      if (r.entry) list.push(r.entry)
      out.set(r.agentId, list)
    }
    // Initialize empty array for agents with zero attachments so callers
    // can blindly read `map.get(id) ?? []` without distinguishing
    // "missing" from "explicitly empty."
    for (const id of agentIds) if (!out.has(id)) out.set(id, [])
    return out
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      const legacy = await db.knowledgeEntry.findMany({
        where: { agentId: { in: agentIds } },
      }).catch(() => [] as any[])
      for (const e of legacy) {
        if (!e.agentId) continue
        const list = out.get(e.agentId) ?? []
        list.push(e)
        out.set(e.agentId, list)
      }
      for (const id of agentIds) if (!out.has(id)) out.set(id, [])
      return out
    }
    throw err
  }
}
