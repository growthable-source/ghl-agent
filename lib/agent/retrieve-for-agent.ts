/**
 * Phase-2 retrieval, packaged for any agent runtime path.
 *
 * Why this exists:
 *   Multiple call sites — playground, Twilio SMS, webhook events,
 *   conversations resume — used to build their prompts inline with
 *   the legacy lib/rag buildKnowledgeBlock and never invoked the new
 *   pgvector retrieval. The result: an operator could ingest 500
 *   pages, ask the agent a question about them, and get nothing back.
 *
 *   Centralising the "given an agent + a message, fetch the relevant
 *   chunks and format them" logic here means every runtime hits the
 *   same path. New runtime callers just import this.
 *
 * Returns:
 *   { block, chunks }
 *   - `block` is the formatted prompt section (empty string on miss)
 *   - `chunks` is the raw RetrievedChunk[] so the caller can surface
 *     them in a debug panel (the playground does this)
 *
 * Failure semantics: any failure swallows to {block:'', chunks:[]}.
 * Retrieval augments the prompt; it must never break a chat reply.
 */

import { db } from '@/lib/db'
import { retrieveChunks, buildRetrievedKnowledgeBlock, debugRetrieveChunks, type RetrievedChunk, type RetrievalDebug } from '../ingest/retrieve'
import { globalCollectionsReady } from '@/lib/knowledge/migration-state'

interface AgentForRetrieval {
  id?: string
  workspaceId: string
  /** false = read only the collections attached via AgentCollection
   *  (an empty set then means "no indexed knowledge at all").
   *  true / undefined = read every collection in the workspace, so
   *  collections added later are picked up automatically. */
  knowledgeScopeAll?: boolean | null
  /** Per-collection usage triggers (Agent.knowledgeConditions), keyed by
   *  KnowledgeCollection id — the same key the prompt-stuffed path uses,
   *  because collections are now the only container an operator sees. */
  knowledgeConditions?: Record<string, string> | null
}

export interface AgentKnowledgeScope {
  /** The collections this agent reads, or null for "everything in the
   *  workspace". */
  collectionIds: string[] | null
  /** Subset of collectionIds living in ANOTHER workspace and flagged
   *  KnowledgeCollection.isGlobal — the shared canonical corpus.
   *
   *  Always [] when collectionIds is null: a workspace-wide agent has no
   *  explicit attachment list, and the attachment IS the authorisation
   *  for a cross-workspace read. */
  globalCollectionIds: string[]
}

/**
 * What this agent is allowed to retrieve from. One small query per
 * message; the alternative was threading the id list through ten
 * different runtime call sites and getting it wrong in at least one.
 *
 * Failure semantics are deliberately asymmetric: the scope fails OPEN
 * to workspace-wide (a broken lookup must never silently blind an
 * agent) while the cross-workspace widening fails CLOSED.
 */
export async function resolveAgentKnowledgeScope(
  agent: AgentForRetrieval,
): Promise<AgentKnowledgeScope> {
  const workspaceWide: AgentKnowledgeScope = { collectionIds: null, globalCollectionIds: [] }
  if (agent.knowledgeScopeAll !== false) return workspaceWide
  if (!agent.id) return workspaceWide
  try {
    // Pre-migration: no isGlobal column, so selecting it is a P2022.
    // The agent keeps working off its own collections; it just can't
    // see the corpus until the SQL runs.
    if (!(await globalCollectionsReady())) {
      const rows = await db.agentCollection.findMany({
        where: { agentId: agent.id },
        select: { collectionId: true },
      })
      return { collectionIds: rows.map(r => r.collectionId), globalCollectionIds: [] }
    }
    const rows = await db.agentCollection.findMany({
      where: { agentId: agent.id },
      select: {
        collectionId: true,
        collection: { select: { id: true, workspaceId: true, isGlobal: true } },
      },
    })
    return {
      collectionIds: rows.map(r => r.collectionId),
      // Same-workspace collections need no widening — the base tenancy
      // arm already covers them, and leaving them out keeps the fast path.
      globalCollectionIds: rows
        .filter(r => r.collection?.isGlobal === true
          && r.collection.workspaceId !== agent.workspaceId)
        .map(r => r.collection!.id),
    }
  } catch {
    return workspaceWide
  }
}


export interface RetrievalForAgentResult {
  block: string
  chunks: RetrievedChunk[]
}

export async function retrieveAndFormatForAgent(
  agent: AgentForRetrieval,
  message: string | null | undefined,
): Promise<RetrievalForAgentResult> {
  // Guard rails match build-base-prompt: workspace must exist, message
  // must be substantive enough to bother embedding.
  if (!agent?.workspaceId) return { block: '', chunks: [] }
  if (!message || message.trim().length < 3) return { block: '', chunks: [] }

  try {
    // Narrowed scope only when the operator explicitly unticked
    // something (knowledgeScopeAll === false). Then the attached set is
    // authoritative, empty included.
    const scope = await resolveAgentKnowledgeScope(agent)

    const chunks = await retrieveChunks(agent.workspaceId, message, {
      limit: 6,
      collectionIds: scope.collectionIds ?? [],
      scopeToCollections: scope.collectionIds !== null,
      globalCollectionIds: scope.globalCollectionIds,
    })
    return { block: buildRetrievedKnowledgeBlock(chunks, normaliseConditions(agent.knowledgeConditions)), chunks }
  } catch (err) {
    console.warn('[retrieveAndFormatForAgent] failed:', errMsg(err))
    return { block: '', chunks: [] }
  }
}

/**
 * Shape used by the playground response (and any future debug surface
 * that wants to say "here's what the agent read"). Strips embeddings
 * and full content down to a previewable size.
 */
export interface KnowledgeUsedItem {
  sourceUrl: string
  sourceType: string
  title: string
  preview: string
  similarity: number
  taxonomyTags: string[]
}

export function summariseRetrievedChunks(chunks: RetrievedChunk[]): KnowledgeUsedItem[] {
  return chunks.map(c => ({
    sourceUrl: c.sourceUrl,
    sourceType: c.sourceType,
    title: (c.sourceMetadata?.page_title as string)
      || (c.sourceMetadata?.section_heading as string)
      || c.primaryTopic
      || '(untitled)',
    preview: c.content.trim().replace(/\s+/g, ' ').slice(0, 240),
    similarity: c.similarity,
    taxonomyTags: c.taxonomyTags,
  }))
}

/**
 * Playground-only diagnostic. Returns the full RetrievalDebug shape
 * so the operator can see WHY a query did/didn't match — chunk counts,
 * top similarity, scope, and a categorical reason code the UI maps
 * to a clear sentence.
 */
export async function debugRetrieveForAgent(
  agent: AgentForRetrieval,
  message: string,
): Promise<RetrievalDebug | null> {
  if (!agent?.workspaceId) return null
  try {
    const scope = await resolveAgentKnowledgeScope(agent)
    return await debugRetrieveChunks(agent.workspaceId, message, {
      limit: 6,
      collectionIds: scope.collectionIds ?? [],
      scopeToCollections: scope.collectionIds !== null,
      globalCollectionIds: scope.globalCollectionIds,
    })
  } catch (err) {
    console.warn('[debugRetrieveForAgent] failed:', errMsg(err))
    return null
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Agent.knowledgeConditions comes straight off a Prisma Json column, so
 * shape-check before trusting it. Non-object / non-string values drop out.
 */
export function normaliseConditions(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return Object.keys(out).length > 0 ? out : null
}
