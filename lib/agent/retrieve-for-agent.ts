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
    const chunks = await retrieveChunks(agent.workspaceId, message, {
      limit: 6,
      // Empty array = workspace-wide. Non-empty = restricted to those
      // domains. Same contract as everywhere else in the codebase.
      knowledgeDomainIds: agent.knowledgeDomainIds ?? [],
    })
    return { block: buildRetrievedKnowledgeBlock(chunks), chunks }
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
    })
  } catch (err) {
    console.warn('[debugRetrieveForAgent] failed:', errMsg(err))
    return null
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
