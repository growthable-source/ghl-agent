/**
 * Retrieval — pgvector cosine search over KnowledgeChunk rows.
 *
 * The query side of the Phase 2 RAG stack. The agent runner calls
 * retrieveChunks() with the visitor's incoming message; we embed
 * it (input_type=query for Voyage's asymmetric retrieval head),
 * run a single SQL against the HNSW index, and return the top-K
 * chunks ordered by cosine similarity.
 *
 * Tenancy: scoped to the agent's workspaceId. Every
 * KnowledgeDomain belongs to a workspace; retrieval filters via
 * the join. Brand priority / brand-origin / visibility are
 * recorded faithfully on each chunk but IGNORED at launch — the
 * "single shared pool" decision from the architecture lock holds
 * until the eval triggers a flip to scoped retrieval.
 *
 * Failure semantics: any failure (missing Voyage key, network,
 * SQL error) returns []. The agent falls through to whatever
 * legacy knowledge entries are configured. Knowledge retrieval
 * is augmentation, never the only ground truth.
 */

import { db } from '@/lib/db'
import { embedTexts } from './embed'

export interface RetrievedChunk {
  id: string
  content: string
  sourceUrl: string
  sourceType: string
  primaryTopic: string | null
  taxonomyTags: string[]
  sourceMetadata: Record<string, unknown>
  /** 0-1, higher is better. 1 - cosine distance. */
  similarity: number
}

interface RetrieveOptions {
  /** Top-K to return. Default 6 — fits comfortably in the prompt
   *  budget without overwhelming Claude's attention. */
  limit?: number
  /** Optional single-domain filter. Mostly used by the
   *  "Try a question" debug panel; agent retrieval uses
   *  knowledgeDomainIds below. */
  knowledgeDomainId?: string
  /** Per-agent scope. When non-empty, retrieval is restricted to
   *  these knowledge_domain_ids. Empty / undefined = workspace-wide
   *  (default — backward compatible with agents that haven't picked
   *  scopes yet). */
  knowledgeDomainIds?: string[]
  /** Minimum similarity threshold. Default 0.4 — chunks below this
   *  are usually noise. Tighten when retrieval starts pulling
   *  unrelated content; loosen when sparse domains miss real hits. */
  minSimilarity?: number
}

/**
 * Retrieve the top-K most similar chunks for a query within a workspace.
 * Empty array on any failure; never throws.
 */
export async function retrieveChunks(
  workspaceId: string,
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const trimmed = (query || '').trim()
  if (!trimmed || trimmed.length < 3) return []

  const limit = Math.max(1, Math.min(20, opts.limit ?? 6))
  // 0.25 default — Voyage cosine similarities for "clearly relevant"
  // content land between 0.3 and 0.6, not 0.5+. The old 0.4 floor
  // dropped legitimate matches and left operators with an empty
  // retrieval block and no idea why.
  const minSimilarity = opts.minSimilarity ?? 0.25

  // Embed the query. Voyage uses different projection heads for
  // documents vs queries; specifying input_type=query is the
  // asymmetric-retrieval pattern Voyage documents.
  let queryEmbedding: number[]
  try {
    const result = await embedTexts([trimmed], { inputType: 'query' })
    if (!result.length || !result[0].embedding) return []
    queryEmbedding = result[0].embedding
  } catch (err) {
    console.warn('[retrieve] query embed failed:', err instanceof Error ? err.message : String(err))
    return []
  }

  // pgvector accepts the embedding as a quoted literal cast to
  // ::vector. The HNSW index covers WHERE supersededAt IS NULL +
  // ORDER BY embedding <=> ?, so this is one index scan.
  const literal = `[${queryEmbedding.join(',')}]`

  try {
    // Domain filter: single id OR a per-agent list. The list takes
    // precedence when both happen to be passed. Empty list = no filter
    // (workspace-wide), which is the backward-compatible default.
    let domainFilter = db.$queryRaw``
    if (opts.knowledgeDomainIds && opts.knowledgeDomainIds.length > 0) {
      domainFilter = db.$queryRaw`AND c."knowledgeDomainId" = ANY(${opts.knowledgeDomainIds}::text[])`
    } else if (opts.knowledgeDomainId) {
      domainFilter = db.$queryRaw`AND c."knowledgeDomainId" = ${opts.knowledgeDomainId}`
    }

    const rows = await db.$queryRaw<Array<{
      id: string
      content: string
      sourceUrl: string
      sourceType: string
      primaryTopic: string | null
      taxonomyTags: string[]
      sourceMetadata: Record<string, unknown> | null
      distance: number | string
    }>>`
      SELECT
        c.id,
        c.content,
        c."sourceUrl",
        c."sourceType",
        c."primaryTopic",
        c."taxonomyTags",
        c."sourceMetadata",
        (c.embedding <=> ${literal}::vector) AS distance
      FROM "KnowledgeChunk" c
      INNER JOIN "KnowledgeDomain" d ON d.id = c."knowledgeDomainId"
      WHERE d."workspaceId" = ${workspaceId}
        AND c."supersededAt" IS NULL
        AND c.embedding IS NOT NULL
        ${domainFilter}
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT ${limit}
    `

    // Convert cosine distance (0=identical, 2=opposite) to a
    // similarity score in [0,1]. Filter on minSimilarity to drop
    // chunks that obviously aren't relevant. Without this floor,
    // queries on niche topics still pull the 6 least-bad chunks
    // even when none are useful, which the agent then quotes as
    // authoritative.
    const chunks: RetrievedChunk[] = rows
      .map(r => ({
        id: r.id,
        content: r.content,
        sourceUrl: r.sourceUrl,
        sourceType: r.sourceType,
        primaryTopic: r.primaryTopic,
        taxonomyTags: r.taxonomyTags ?? [],
        sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown>,
        similarity: clamp01(1 - Number(r.distance)),
      }))
      .filter(c => c.similarity >= minSimilarity)

    // Bump usage stats best-effort. Lets us cold-prune chunks
    // nobody's ever retrieved.
    if (chunks.length > 0) {
      const ids = chunks.map(c => c.id)
      db.$executeRaw`
        UPDATE "KnowledgeChunk"
        SET "useCount" = "useCount" + 1,
            "lastUsedAt" = NOW()
        WHERE id = ANY(${ids}::text[])
      `.catch(() => { /* logging-only failure */ })
    }

    return chunks
  } catch (err) {
    // Common failures: pgvector extension not installed (P2010 or
    // syntax error on ::vector cast), KnowledgeChunk table missing
    // (pre-migration). Return [] so the agent runs without
    // retrieval rather than breaking the chat.
    const msg = err instanceof Error ? err.message : String(err)
    const code = (err as { code?: string } | null)?.code
    if (code !== 'P2021' && !/relation .* does not exist|operator does not exist/i.test(msg)) {
      console.warn('[retrieve] pgvector query failed:', msg)
    }
    return []
  }
}

/**
 * Format retrieved chunks as a system-prompt block. Empty string
 * when no chunks — the prompt builder appends safely.
 *
 * Each chunk is numbered [1]..[N] with a citable source URL and
 * page title. The agent is instructed to cite by number when
 * referencing — operators trace back through the inbox sidebar.
 */
export function buildRetrievedKnowledgeBlock(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return ''

  const formatted = chunks.map((c, i) => {
    const meta = c.sourceMetadata
    const title = (meta?.page_title as string)
      || (meta?.section_heading as string)
      || c.primaryTopic
      || '(untitled)'
    const tags = c.taxonomyTags.length > 0 ? ` · ${c.taxonomyTags.join(', ')}` : ''
    // Truncate per-chunk to keep token usage bounded. 1500 chars
    // ≈ ~400 tokens; 6 chunks × 400 = ~2400 tokens of context.
    const body = c.content.trim().slice(0, 1500)
    return `### [${i + 1}] ${title}${tags}
Source: ${c.sourceUrl}

${body}`
  }).join('\n\n---\n\n')

  return `

## KNOWLEDGE FROM YOUR SOURCES
The passages below were retrieved from the operator's knowledge base based on the visitor's question. Use them as your primary source of truth.

Rules:
- Cite by number when referencing — "according to [2]..." or "[1] says...".
- If the passages don't answer the visitor's question, SAY SO. Don't invent specifics.
- Prefer passage facts over your prior knowledge when they conflict.

${formatted}
`
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

/**
 * Diagnostic retrieval — same query as retrieveChunks, but returns
 * the top-K WITHOUT a similarity threshold + counts of what was in
 * scope. Used by the playground to show operators exactly why a
 * question didn't match: too-tight threshold, wrong domain scope,
 * empty embeddings, etc.
 *
 * Never used by the actual agent runtime — that path still filters
 * by minSimilarity to keep weak matches out of the prompt.
 */
export interface RetrievalDebug {
  /** Top-K chunks regardless of threshold. Sorted by similarity desc. */
  topChunks: RetrievedChunk[]
  /** How many chunks were in scope (workspace + domain filter + non-null embeddings). */
  chunksInScope: number
  /** How many chunks were in workspace but excluded by domain scope or null embeddings. */
  chunksInWorkspace: number
  /** How many of the workspace chunks had a NULL embedding (failed ingest). */
  chunksWithNullEmbedding: number
  /** Highest similarity score we found, or null if no chunks at all. */
  topSimilarity: number | null
  /** Which threshold WOULD have been applied in the agent runtime. */
  thresholdForRuntime: number
  /** The KnowledgeDomain names this query was scoped to. Empty = all. */
  scopedDomainNames: string[]
  /** Total domain count in this workspace, regardless of agent scope. */
  domainsInWorkspace: number
  /** Reason — surfaces the most likely cause of zero matches. */
  reason:
    | 'good_match'           // top chunk above threshold
    | 'below_threshold'      // chunks exist, top below threshold
    | 'empty_scope'          // agent scoped to domains with no chunks
    | 'no_chunks_in_workspace' // nothing indexed yet
    | 'embeddings_failed'    // chunks exist but all embeddings are null
    | 'query_too_short'      // not enough signal to embed
    | 'embed_failed'         // Voyage call broke
    | 'pgvector_missing'     // CREATE EXTENSION vector not run
    | 'query_failed'         // pgvector query threw something else
  /** When reason involves a thrown error, the raw error message
   *  (truncated). Helps the operator paste it into a bug report. */
  errorDetail: string | null
}

export async function debugRetrieveChunks(
  workspaceId: string,
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievalDebug> {
  const trimmed = (query || '').trim()
  const limit = Math.max(1, Math.min(20, opts.limit ?? 6))
  const thresholdForRuntime = opts.minSimilarity ?? 0.25

  // Always count what's in the workspace so the UI can say
  // "no chunks indexed yet" vs "your agent isn't scoped to them".
  const [{ count: chunksInWorkspace }, { count: chunksWithNullEmbedding }, { count: domainsInWorkspace }] = await Promise.all([
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM "KnowledgeChunk" c
      INNER JOIN "KnowledgeDomain" d ON d.id = c."knowledgeDomainId"
      WHERE d."workspaceId" = ${workspaceId} AND c."supersededAt" IS NULL
    `.then(r => ({ count: Number(r[0]?.count ?? 0) })).catch(() => ({ count: 0 })),
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM "KnowledgeChunk" c
      INNER JOIN "KnowledgeDomain" d ON d.id = c."knowledgeDomainId"
      WHERE d."workspaceId" = ${workspaceId}
        AND c."supersededAt" IS NULL
        AND c.embedding IS NULL
    `.then(r => ({ count: Number(r[0]?.count ?? 0) })).catch(() => ({ count: 0 })),
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM "KnowledgeDomain" WHERE "workspaceId" = ${workspaceId}
    `.then(r => ({ count: Number(r[0]?.count ?? 0) })).catch(() => ({ count: 0 })),
  ])

  // Resolve scoped domain names. Empty = workspace-wide.
  let scopedDomainNames: string[] = []
  if (opts.knowledgeDomainIds && opts.knowledgeDomainIds.length > 0) {
    try {
      const names = await db.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM "KnowledgeDomain"
        WHERE id = ANY(${opts.knowledgeDomainIds}::text[])
          AND "workspaceId" = ${workspaceId}
      `
      scopedDomainNames = names.map(n => n.name)
    } catch { /* migration not run; leave empty */ }
  }

  const baseEmpty: Omit<RetrievalDebug, 'reason'> = {
    topChunks: [],
    chunksInScope: 0,
    chunksInWorkspace,
    chunksWithNullEmbedding,
    topSimilarity: null,
    thresholdForRuntime,
    scopedDomainNames,
    domainsInWorkspace,
    errorDetail: null,
  }

  if (chunksInWorkspace === 0) {
    return { ...baseEmpty, reason: 'no_chunks_in_workspace' }
  }
  if (chunksInWorkspace > 0 && chunksInWorkspace === chunksWithNullEmbedding) {
    return { ...baseEmpty, reason: 'embeddings_failed' }
  }
  if (!trimmed || trimmed.length < 3) {
    return { ...baseEmpty, reason: 'query_too_short' }
  }

  // pgvector extension probe. The actual vector query later needs the
  // `vector` type + `<=>` operator + `::vector` cast — all provided by
  // the `vector` extension. If it's missing every retrieval fails and
  // the only fix is `CREATE EXTENSION vector;` in Supabase. We probe
  // first so the diagnostic can say that specifically instead of
  // dumping a generic "query failed."
  try {
    const probe = await db.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') as exists
    `
    if (!probe[0]?.exists) {
      return {
        ...baseEmpty,
        reason: 'pgvector_missing',
        errorDetail: 'pg_extension has no row for vector — extension not installed in this database.',
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ...baseEmpty,
      reason: 'pgvector_missing',
      errorDetail: msg.slice(0, 300) || 'pg_extension probe failed',
    }
  }

  // Embed the query.
  let queryEmbedding: number[]
  try {
    const result = await embedTexts([trimmed], { inputType: 'query' })
    if (!result.length || !result[0].embedding) return { ...baseEmpty, reason: 'embed_failed' }
    queryEmbedding = result[0].embedding
  } catch {
    return { ...baseEmpty, reason: 'embed_failed' }
  }
  const literal = `[${queryEmbedding.join(',')}]`

  try {
    let domainFilter = db.$queryRaw``
    if (opts.knowledgeDomainIds && opts.knowledgeDomainIds.length > 0) {
      domainFilter = db.$queryRaw`AND c."knowledgeDomainId" = ANY(${opts.knowledgeDomainIds}::text[])`
    }

    // Count what's in *scope* (workspace + domain filter + non-null embeddings).
    const scopeCountRows = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint as count FROM "KnowledgeChunk" c
      INNER JOIN "KnowledgeDomain" d ON d.id = c."knowledgeDomainId"
      WHERE d."workspaceId" = ${workspaceId}
        AND c."supersededAt" IS NULL
        AND c.embedding IS NOT NULL
        ${domainFilter}
    `
    const chunksInScope = Number(scopeCountRows[0]?.count ?? 0)

    if (chunksInScope === 0) {
      return { ...baseEmpty, chunksInScope, reason: 'empty_scope' }
    }

    const rows = await db.$queryRaw<Array<{
      id: string
      content: string
      sourceUrl: string
      sourceType: string
      primaryTopic: string | null
      taxonomyTags: string[]
      sourceMetadata: Record<string, unknown> | null
      distance: number | string
    }>>`
      SELECT
        c.id, c.content, c."sourceUrl", c."sourceType",
        c."primaryTopic", c."taxonomyTags", c."sourceMetadata",
        (c.embedding <=> ${literal}::vector) AS distance
      FROM "KnowledgeChunk" c
      INNER JOIN "KnowledgeDomain" d ON d.id = c."knowledgeDomainId"
      WHERE d."workspaceId" = ${workspaceId}
        AND c."supersededAt" IS NULL
        AND c.embedding IS NOT NULL
        ${domainFilter}
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT ${limit}
    `

    const topChunks: RetrievedChunk[] = rows.map(r => ({
      id: r.id,
      content: r.content,
      sourceUrl: r.sourceUrl,
      sourceType: r.sourceType,
      primaryTopic: r.primaryTopic,
      taxonomyTags: r.taxonomyTags ?? [],
      sourceMetadata: (r.sourceMetadata ?? {}) as Record<string, unknown>,
      similarity: clamp01(1 - Number(r.distance)),
    }))

    const topSimilarity = topChunks.length > 0 ? topChunks[0].similarity : null
    const reason: RetrievalDebug['reason'] =
      topSimilarity !== null && topSimilarity >= thresholdForRuntime
        ? 'good_match'
        : 'below_threshold'

    return {
      topChunks,
      chunksInScope,
      chunksInWorkspace,
      chunksWithNullEmbedding,
      topSimilarity,
      thresholdForRuntime,
      scopedDomainNames,
      domainsInWorkspace,
      errorDetail: null,
      reason,
    }
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    console.warn('[debugRetrieve] pgvector query failed:', raw)
    // Look for the most common pgvector failure modes and route to a
    // more specific reason where we can. Otherwise generic query_failed
    // with the raw message so the operator at least knows what
    // happened.
    if (/extension.*vector|operator.*<=>|type "vector"/i.test(raw)) {
      return {
        ...baseEmpty,
        reason: 'pgvector_missing',
        errorDetail: raw.slice(0, 300),
      }
    }
    return {
      ...baseEmpty,
      reason: 'query_failed',
      errorDetail: raw.slice(0, 300) || null,
    }
  }
}
