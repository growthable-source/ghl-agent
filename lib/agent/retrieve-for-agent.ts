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

import { retrieveChunks, buildRetrievedKnowledgeBlock, debugRetrieveChunks, type RetrievedChunk, type RetrievalDebug } from '../ingest/retrieve'

interface AgentForRetrieval {
  id?: string
  workspaceId: string
  knowledgeDomainIds?: string[] | null
  /** false = read only the (possibly empty) knowledgeDomainIds set.
   *  true / undefined = read every domain in the workspace (default). */
  knowledgeScopeAll?: boolean | null
  /** Per-source usage triggers (Agent.knowledgeConditions). Keyed by
   *  KnowledgeDomain id here; collection-keyed entries are consumed by
   *  the prompt-stuffed path in lib/rag, not this one. */
  knowledgeConditions?: Record<string, string> | null
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

  // scopeToDomains only when the operator explicitly narrowed scope
  // (knowledgeScopeAll === false). Then an empty id list means "read no
  // indexed knowledge"; otherwise empty stays workspace-wide.
  const scopeToDomains = agent.knowledgeScopeAll === false

  try {
    const chunks = await retrieveChunks(agent.workspaceId, message, {
      limit: 6,
      knowledgeDomainIds: agent.knowledgeDomainIds ?? [],
      scopeToDomains,
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
    return await debugRetrieveChunks(agent.workspaceId, message, {
      limit: 6,
      knowledgeDomainIds: agent.knowledgeDomainIds ?? [],
      scopeToDomains: agent.knowledgeScopeAll === false,
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
