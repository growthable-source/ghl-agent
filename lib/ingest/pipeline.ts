/**
 * Pipeline orchestrator.
 *
 * One entry point: `ingestSource(sourceId)`. Looks up the source,
 * picks the right adapter, runs discover → fetch → normalize → chunk
 * → classify → embed → write, logs every step into an IngestionRun.
 *
 * Idempotency contract (per brief):
 *   - Re-ingesting an unchanged source produces ZERO new chunks and
 *     ZERO new embedding calls. Match by (sourceUrl, chunkIndex)
 *     and contentHash; matching hash → bump lastVerifiedAt only.
 *   - Changed chunks insert as new rows with supersedesId pointing
 *     at the old row; old row gets supersededAt + reason.
 *   - Pages that vanish from the source mark their chunks superseded
 *     with reason 'source_content_removed'.
 *   - Per-page failures are caught and logged into errorLog; they
 *     don't abort the run.
 */

import crypto from 'crypto'
import { db } from '@/lib/db'
import { docsAdapter } from './adapters/docs'
import { pdfAdapter } from './adapters/pdf'
import { youtubeAdapter } from './adapters/youtube'
import { rssAdapter } from './adapters/rss'
import type { SourceAdapter, AdapterContext, NormalizedContent } from './adapters/types'
import { chunkMarkdown } from './chunker'
import { classifyChunk, type TaxonomyRow } from './classify'
import { embedTexts, EMBEDDING_MODEL } from './embed'

const ADAPTERS: Record<string, SourceAdapter> = {
  docs:    docsAdapter,
  pdf:     pdfAdapter,
  youtube: youtubeAdapter,
  rss:     rssAdapter,
}

export interface IngestResult {
  runId: string
  status: 'success' | 'partial' | 'failed'
  pagesAttempted: number
  pagesSucceeded: number
  chunksCreated: number
  chunksSuperseded: number
  /** True when the run stopped at the soft deadline with pages left —
   *  the caller should queue a continuation run. Hash-matching makes
   *  the re-walk cheap: already-ingested pages skip embedding. */
  deadlineExhausted?: boolean
  /** Discovered URLs skipped because they were already crawled (already
   *  have live chunks ANYWHERE — this source, or another one). The reason
   *  fetch/Firecrawl cost stays flat across recrawls instead of
   *  re-scraping the whole site. When the existing chunks belonged to a
   *  DIFFERENT source, they were cloned into this one rather than
   *  skipped outright — see `chunksCreated`, which folds in cloned rows. */
  skippedAlreadyCrawled?: number
}

export interface IngestOptions {
  /** Pre-created IngestionRun id. When provided the pipeline updates
   *  that row instead of creating a new one — used by the async POST
   *  /run handler so the client has something to poll from the moment
   *  the request returns. */
  runId?: string
  /** Soft wall-clock deadline (epoch ms). When the per-page loop
   *  crosses it, the run finishes gracefully as 'partial' with
   *  deadlineExhausted=true instead of being killed mid-page by the
   *  serverless maxDuration. The cron queues a continuation, so big
   *  sites complete across ticks rather than truncating at one
   *  function budget. */
  deadlineAt?: number
  /** Force a full re-scrape: fetch every discovered URL even if it was
   *  already crawled. Off by default — steady-state recrawls only
   *  follow NEW links and never re-scrape already-indexed pages, which
   *  is what keeps Firecrawl credit use flat. Set true only for a
   *  deliberate content-change refresh of an existing source. */
  force?: boolean
}

interface ErrorEntry {
  url: string
  stage: 'discover' | 'fetch' | 'normalize' | 'chunk' | 'classify' | 'embed' | 'write' | 'copy'
  message: string
  ts: string
}

export async function ingestSource(sourceId: string, opts: IngestOptions = {}): Promise<IngestResult> {
  const source = await (db as any).knowledgeSource.findUnique({
    where: { id: sourceId },
    include: { domain: { include: { workspace: { select: { id: true } } } } },
  })
  if (!source) throw new Error(`KnowledgeSource ${sourceId} not found`)

  const adapter = ADAPTERS[source.sourceType]
  if (!adapter) throw new Error(`No adapter registered for sourceType=${source.sourceType}`)

  const taxonomyRows: TaxonomyRow[] = await (db as any).taxonomy.findMany({
    where: { knowledgeDomainId: source.knowledgeDomainId },
    select: { key: true, label: true, aliases: true, parentKey: true },
  })
  const taxonomyVersion = taxonomyRows.length
    ? Math.max(...await (db as any).taxonomy.findMany({
        where: { knowledgeDomainId: source.knowledgeDomainId },
        select: { taxonomyVersion: true },
      }).then((rows: { taxonomyVersion: number }[]) => rows.map(r => r.taxonomyVersion).concat(1)))
    : 1
  const defaultIntentTags: string[] = source.domain.defaultIntentTags ?? []

  // Use the caller-supplied run row if present; otherwise create one.
  // The async POST /run handler creates it so the client can poll
  // from the moment the response returns.
  const run = opts.runId
    ? await (db as any).ingestionRun.findUnique({ where: { id: opts.runId } })
    : await (db as any).ingestionRun.create({ data: { sourceId, status: 'running' } })
  if (!run) throw new Error(`IngestionRun ${opts.runId} not found`)

  const ctx: AdapterContext = {
    source: {
      id: source.id,
      sourceType: source.sourceType,
      urlOrIdentifier: source.urlOrIdentifier,
      crawlConfig: source.crawlConfig ?? {},
    },
    workspaceId: source.domain.workspace.id,
  }

  const errors: ErrorEntry[] = []
  let pagesAttempted = 0
  let deadlineExhausted = false
  let pagesSucceeded = 0
  let chunksCreated = 0
  let chunksSuperseded = 0
  let skippedAlreadyCrawled = 0

  try {
    const discovered = await adapter.discover(ctx).catch(err => {
      errors.push({ url: source.urlOrIdentifier, stage: 'discover', message: err?.message ?? 'unknown', ts: new Date().toISOString() })
      return [] as Awaited<ReturnType<SourceAdapter['discover']>>
    })

    // Only follow NEW links. A URL that already has live chunks was
    // already crawled — re-fetching it buys nothing and, for
    // JS-rendered pages, burns a Firecrawl scrape every recrawl (the
    // hash-match below only saves re-EMBEDDING, not the fetch). New docs
    // pages and new RSS items aren't indexed yet, so they still ingest;
    // feeds keep updating because each new item is a new URL. `force`
    // bypasses this for a deliberate full re-scrape.
    //
    // Lookup scope: GLOBAL by sourceUrl (bounded to the discovered hosts
    // so the query never scans unrelated URLs). It used to be per-source,
    // which meant a duplicate source pointing at an already-indexed site
    // re-fetched every page each recrawl and then no-op'd at the hash
    // match — full fetch cost, zero chunks, forever (the July 2026
    // runaway recrawl). Do NOT revert to per-source fetching.
    //
    // But the fetch decision and the OWNERSHIP decision are different
    // questions. A URL already indexed under THIS source is a true skip
    // (unchanged). A URL indexed ONLY under a DIFFERENT source is also
    // skipped for fetch — but its chunks (content, embedding,
    // classification) are CLONED into this source/domain below, so this
    // source's own domain isn't left empty just because someone else got
    // there first (cross-tenant knowledge isolation bug, prod incident
    // 2026-07-17 — see prisma/migrations/manual_chunk_unique_per_source.sql).
    let toFetch = discovered
    let chunksCopied = 0
    if (!opts.force && discovered.length > 0) {
      const hosts = Array.from(new Set(
        discovered.map(d => {
          try { return new URL(d.identifier).host.toLowerCase() } catch { return '' }
        }),
      )).filter(Boolean)
      const indexed: Array<{ sourceUrl: string; sourceId: string }> = hosts.length === 0 ? [] :
        await (db as any).knowledgeChunk.findMany({
          where: {
            supersededAt: null,
            OR: hosts.map(h => ({ sourceUrl: { contains: `//${h}`, mode: 'insensitive' } })),
          },
          select: { sourceUrl: true, sourceId: true },
        }).catch(() => [])

      // Canonical URL key -> which source id(s) currently own live chunks
      // for it, plus the exact sourceUrl string(s) on record (the clone
      // INSERT below matches on the literal sourceUrl column, not the
      // canonical key).
      const ownerByKey = new Map<string, { sourceIds: Set<string>; sourceUrls: Set<string> }>()
      for (const row of indexed) {
        const key = canonicalUrlKey(row.sourceUrl)
        if (!key) continue
        let info = ownerByKey.get(key)
        if (!info) {
          info = { sourceIds: new Set(), sourceUrls: new Set() }
          ownerByKey.set(key, info)
        }
        info.sourceIds.add(row.sourceId)
        info.sourceUrls.add(row.sourceUrl)
      }

      if (ownerByKey.size > 0) {
        const crossSourceUrls = new Set<string>()
        toFetch = discovered.filter(item => {
          const key = canonicalUrlKey(item.identifier)
          const info = key ? ownerByKey.get(key) : undefined
          if (!info) return true // genuinely new — fetch it
          skippedAlreadyCrawled++
          if (!info.sourceIds.has(source.id)) {
            // Indexed only under other source(s) — queue for cloning.
            for (const u of info.sourceUrls) crossSourceUrls.add(u)
          }
          return false
        })

        if (crossSourceUrls.size > 0) {
          try {
            const urls = Array.from(crossSourceUrls)
            // One INSERT ... SELECT per batch. Picks the highest
            // contentVersion per (sourceUrl, chunkIndex) among live
            // (supersededAt IS NULL) rows and re-parents a copy onto this
            // source/domain. Identity + lifecycle columns are reset;
            // content, embedding, and classification are copied verbatim
            // — zero re-fetch, re-embed, or re-classify cost.
            const copied = await db.$executeRaw`
              INSERT INTO "KnowledgeChunk" (
                "id", "knowledgeDomainId", "sourceId",
                "content", "contentHash", "sourceUrl", "sourceType", "sourceIdentifier",
                "chunkIndex", "totalChunks", "sourceMetadata", "embeddingModel", "embedding",
                "primaryTopic", "taxonomyTags", "intentTags", "taxonomyVersion", "autoTopicAttempts",
                "confidenceTier", "qualityScore", "contentVersion", "brandIdOrigin", "visibility",
                "useCount", "lastUsedAt", "supersedesId", "supersededAt", "supersessionReason",
                "createdAt", "indexedAt", "lastVerifiedAt"
              )
              SELECT
                gen_random_uuid()::text, ${source.knowledgeDomainId}, ${source.id},
                src."content", src."contentHash", src."sourceUrl", src."sourceType", src."sourceIdentifier",
                src."chunkIndex", src."totalChunks", src."sourceMetadata", src."embeddingModel", src."embedding",
                src."primaryTopic", src."taxonomyTags", src."intentTags", src."taxonomyVersion", src."autoTopicAttempts",
                src."confidenceTier", src."qualityScore",
                -- The per-source unique constraint spans SUPERSEDED rows
                -- too: if this source already holds dead rows for the same
                -- (sourceUrl, chunkIndex) — e.g. after a demo domain swap
                -- back onto a shared site — a verbatim version copy would
                -- 23505. Bump past this source's own graveyard instead.
                GREATEST(src."contentVersion", COALESCE((
                  SELECT MAX(mine."contentVersion") FROM "KnowledgeChunk" mine
                  WHERE mine."sourceId" = ${source.id}
                    AND mine."sourceUrl" = src."sourceUrl"
                    AND mine."chunkIndex" = src."chunkIndex"
                ), 0) + 1),
                src."brandIdOrigin", src."visibility",
                0, NULL, NULL, NULL, NULL,
                now(), now(), now()
              FROM (
                SELECT DISTINCT ON ("sourceUrl", "chunkIndex") *
                FROM "KnowledgeChunk"
                WHERE "sourceUrl" = ANY(${urls}::text[]) AND "supersededAt" IS NULL
                ORDER BY "sourceUrl", "chunkIndex", "contentVersion" DESC
              ) src
            `
            chunksCopied += Number(copied)
            chunksCreated += Number(copied)
            console.log(`[ingest] cloned ${copied} chunk(s) across ${urls.length} already-indexed URL(s) owned by other sources`)
          } catch (err) {
            // A clone failure must not fail the run — worst case this
            // source's domain stays empty for these URLs, same as
            // pre-fix behaviour, and the next recrawl retries the clone.
            errors.push({
              url: source.urlOrIdentifier,
              stage: 'copy',
              message: err instanceof Error ? err.message : 'chunk clone failed',
              ts: new Date().toISOString(),
            })
          }
        }
      }
    }
    if (skippedAlreadyCrawled > 0) {
      console.log(`[ingest] ${skippedAlreadyCrawled}/${discovered.length} discovered URLs already crawled — skipping re-fetch${chunksCopied > 0 ? ` (${chunksCopied} chunk(s) cloned from other sources)` : ''}`)
    }

    // Tell the client how many pages we'll actually fetch so it can
    // render a progress bar with the right total.
    await (db as any).ingestionRun.update({
      where: { id: run.id },
      data: { pagesAttempted: toFetch.length },
    }).catch(() => {})

    for (const item of toFetch) {
      if (opts.deadlineAt && Date.now() > opts.deadlineAt) {
        deadlineExhausted = true
        console.log(`[ingest] soft deadline hit after ${pagesAttempted}/${toFetch.length} pages — continuation will resume`)
        break
      }
      pagesAttempted++
      try {
        const raw = await adapter.fetch(ctx, item).catch(err => {
          throw { stage: 'fetch' as const, message: err?.message ?? 'fetch failed' }
        })
        const normalized = await adapter.normalize(ctx, raw).catch(err => {
          throw { stage: 'normalize' as const, message: err?.message ?? 'normalize failed' }
        })

        const result = await processPage({
          source,
          normalized,
          taxonomyRows,
          taxonomyVersion,
          defaultIntentTags,
        })
        chunksCreated += result.created
        chunksSuperseded += result.superseded
        pagesSucceeded++
      } catch (err: any) {
        const stage = (err && typeof err === 'object' && 'stage' in err) ? err.stage : 'fetch'
        const message = (err && typeof err === 'object' && 'message' in err) ? err.message : String(err)
        errors.push({ url: item.identifier, stage, message, ts: new Date().toISOString() })
      }

      // Incremental progress write per page so the polling UI moves
      // visibly. Fire-and-forget — a transient DB blip mustn't kill
      // the run.
      ;(db as any).ingestionRun.update({
        where: { id: run.id },
        data: {
          pagesSucceeded,
          chunksCreated,
          chunksSuperseded,
          errorLog: errors as any,
        },
      }).catch(() => {})
    }
  } catch (err: any) {
    errors.push({ url: source.urlOrIdentifier, stage: 'discover', message: err?.message ?? 'pipeline failed', ts: new Date().toISOString() })
  }

  const status: IngestResult['status'] = errors.length === 0
    ? (deadlineExhausted ? 'partial' : 'success')
    : pagesSucceeded > 0 ? 'partial' : 'failed'

  await (db as any).ingestionRun.update({
    where: { id: run.id },
    data: {
      status,
      completedAt: new Date(),
      pagesAttempted,
      pagesSucceeded,
      chunksCreated,
      chunksSuperseded,
      errorLog: errors as any,
    },
  })
  await (db as any).knowledgeSource.update({
    where: { id: sourceId },
    data: { lastCrawledAt: new Date() },
  })

  // Auto-organise topics for anything the classifier couldn't place —
  // the "Needs a topic" queue clears itself instead of waiting for an
  // operator to rubber-stamp AI suggestions. Skipped mid-continuation
  // (deadline-cut runs) so one full crawl organises once at the end;
  // best-effort, never fails the run.
  if (!deadlineExhausted && chunksCreated > 0) {
    try {
      const { autoOrganizeTopics } = await import('./auto-topics')
      await autoOrganizeTopics(source.knowledgeDomainId)
    } catch (err: any) {
      console.warn('[ingest] auto-topics skipped:', err?.message)
    }
  }

  return {
    runId: run.id,
    status,
    pagesAttempted,
    pagesSucceeded,
    chunksCreated,
    chunksSuperseded,
    deadlineExhausted,
    skippedAlreadyCrawled,
  }
}

/**
 * Canonical key for "have we already crawled this URL?" comparisons.
 * Folds away the differences that don't change the underlying resource —
 * scheme (http/https), host case, default ports, a single trailing
 * slash, and the fragment — so a link discovered as `http://x/a/`
 * matches a chunk stored (post-redirect) as `https://x/a`. The query
 * string is KEPT: `?id=1` vs `?id=2` can be genuinely different pages,
 * and a false match would silently drop content. Returns '' for inputs
 * that aren't URLs (e.g. a bare YouTube video id), which never match —
 * so non-URL sources keep their existing re-fetch behaviour.
 */
export function canonicalUrlKey(raw: string): string {
  try {
    const u = new URL(raw)
    const host = u.host.toLowerCase() // URL already drops :80/:443
    let path = u.pathname
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
    return `${host}${path}${u.search}`
  } catch {
    return ''
  }
}

interface ProcessPageArgs {
  source: { id: string; knowledgeDomainId: string; sourceType: string }
  normalized: NormalizedContent
  taxonomyRows: TaxonomyRow[]
  taxonomyVersion: number
  defaultIntentTags: string[]
}

async function processPage(args: ProcessPageArgs): Promise<{ created: number; superseded: number }> {
  const { source, normalized, taxonomyRows, taxonomyVersion, defaultIntentTags } = args
  const docTitle = (normalized.metadata?.page_title as string) || normalized.sourceUrl
  const rawChunks = chunkMarkdown(normalized.markdown, docTitle)

  // Existing chunks for this URL UNDER THIS SOURCE that aren't superseded.
  // Scoped by sourceId (not just sourceUrl) because a URL can now have live
  // chunks under MULTIPLE sources — the discover sweep's copy-on-dedupe
  // clones another source's chunks in rather than leaving this domain
  // empty. A global lookup here would pull in another source's rows by
  // chunkIndex and either corrupt this source's version chain or collide
  // with the per-source unique constraint on write.
  const existing: Array<{
    id: string
    chunkIndex: number
    contentHash: string
    contentVersion: number
  }> = await (db as any).knowledgeChunk.findMany({
    where: { sourceId: source.id, sourceUrl: normalized.sourceUrl, supersededAt: null },
    select: { id: true, chunkIndex: true, contentHash: true, contentVersion: true },
  })
  const existingByIndex = new Map(existing.map(c => [c.chunkIndex, c]))

  // Highest contentVersion per chunkIndex INCLUDING superseded rows. The
  // unique constraint (sourceId, sourceUrl, chunkIndex, contentVersion)
  // spans dead rows too, so a re-crawl after an external supersede (e.g.
  // a demo domain swap superseding the whole knowledge domain) must
  // version-bump past the graveyard, not restart at 1 — that exact
  // collision made every page of a post-swap recrawl fail with 23505.
  const versionRows: Array<{ chunkIndex: number; _max: { contentVersion: number | null } }> =
    await (db as any).knowledgeChunk.groupBy({
      by: ['chunkIndex'],
      where: { sourceId: source.id, sourceUrl: normalized.sourceUrl },
      _max: { contentVersion: true },
    })
  const maxVersionByIndex = new Map(versionRows.map(r => [r.chunkIndex, r._max.contentVersion ?? 0]))

  let created = 0
  let superseded = 0

  // Build the work list: which chunks need NEW (hash differs or chunk
  // is new) vs which just need lastVerifiedAt bumped (hash matches).
  type NewChunk = {
    chunkIndex: number
    content: string
    contentHash: string
    sectionHeading: string
    sectionAnchor: string
    approxTokens: number
    superseded: typeof existing[number] | null
  }
  const newWork: NewChunk[] = []
  const verifiedExistingIds: string[] = []

  for (let i = 0; i < rawChunks.length; i++) {
    const c = rawChunks[i]
    const contentHash = sha256(c.content)
    const prior = existingByIndex.get(i) ?? null
    if (prior && prior.contentHash === contentHash) {
      verifiedExistingIds.push(prior.id)
      continue
    }
    newWork.push({
      chunkIndex: i,
      content: c.content,
      contentHash,
      sectionHeading: c.section.heading,
      sectionAnchor: c.section.anchor,
      approxTokens: c.approxTokens,
      superseded: prior,
    })
  }

  // Chunks that vanished (existed before, no longer in the source).
  const vanishedPriorIds = existing
    .filter(p => !rawChunks[p.chunkIndex])
    .map(p => p.id)

  if (verifiedExistingIds.length > 0) {
    await (db as any).knowledgeChunk.updateMany({
      where: { id: { in: verifiedExistingIds } },
      data: { lastVerifiedAt: new Date() },
    })
  }

  if (vanishedPriorIds.length > 0) {
    await (db as any).knowledgeChunk.updateMany({
      where: { id: { in: vanishedPriorIds } },
      data: {
        supersededAt: new Date(),
        supersessionReason: 'source_content_removed',
      },
    })
    superseded += vanishedPriorIds.length
  }

  if (newWork.length === 0) {
    return { created, superseded }
  }

  // Classify + embed in batch. Voyage caps at 128 inputs/call;
  // embedTexts handles batching internally. Haiku classification
  // runs in parallel (cheap per call, but cap concurrency at 8 so
  // we don't spam the API).
  const embeddings = await embedTexts(newWork.map(w => w.content))

  const classifications = await mapWithConcurrency(newWork, 8, async (w) => {
    return classifyChunk({
      content: w.content,
      taxonomy: taxonomyRows,
      defaultIntentTags,
      contextHint: `${docTitle} → ${w.sectionHeading}`,
    })
  })

  // Mark superseded predecessors BEFORE inserting the new rows so the
  // unique constraint on (sourceUrl, chunkIndex, contentVersion) doesn't
  // collide. We increment contentVersion on the new row.
  const supersededIdsBatch = newWork
    .map(w => w.superseded?.id)
    .filter((x): x is string => typeof x === 'string')
  if (supersededIdsBatch.length > 0) {
    await (db as any).knowledgeChunk.updateMany({
      where: { id: { in: supersededIdsBatch } },
      data: {
        supersededAt: new Date(),
        supersessionReason: 'source_content_changed',
      },
    })
    superseded += supersededIdsBatch.length
  }

  for (let i = 0; i < newWork.length; i++) {
    const w = newWork[i]
    const emb = embeddings.find(e => e.index === i)?.embedding
    const klass = classifications[i]
    const nextVersion = Math.max(
      w.superseded?.contentVersion ?? 0,
      maxVersionByIndex.get(w.chunkIndex) ?? 0,
    ) + 1
    const id = crypto.randomBytes(12).toString('hex')

    // Prisma's `KnowledgeChunk.create` doesn't know about the
    // `embedding` vector column — we use a raw SQL insert so the
    // embedding lands in the same row. Scalars first via Prisma
    // would mean a second UPDATE round trip; one INSERT is cleaner.
    const embeddingLiteral = emb ? `'[${emb.join(',')}]'` : 'NULL'
    await db.$executeRawUnsafe(
      `INSERT INTO "KnowledgeChunk" (
        "id", "knowledgeDomainId", "sourceId", "content", "contentHash",
        "sourceUrl", "sourceType", "chunkIndex", "totalChunks",
        "sourceMetadata", "embeddingModel", "embedding",
        "primaryTopic", "taxonomyTags", "intentTags", "taxonomyVersion",
        "confidenceTier", "qualityScore", "supersedesId", "contentVersion"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10::jsonb, $11, ${embeddingLiteral},
        $12, $13::text[], $14::text[], $15,
        $16, $17, $18, $19
      )`,
      id,
      source.knowledgeDomainId,
      source.id,
      w.content,
      w.contentHash,
      normalized.sourceUrl,
      source.sourceType,
      w.chunkIndex,
      rawChunks.length,
      JSON.stringify({
        page_title: normalized.metadata?.page_title ?? null,
        breadcrumb_path: normalized.metadata?.breadcrumb_path ?? [],
        section_heading: w.sectionHeading,
        section_anchor: w.sectionAnchor,
        page_last_updated: normalized.metadata?.page_last_updated ?? null,
        approx_tokens: w.approxTokens,
      }),
      EMBEDDING_MODEL,
      klass.primaryTopic || null,
      klass.taxonomyTags,
      klass.intentTags,
      taxonomyVersion,
      source.sourceType === 'docs' ? 'canonical' : 'provisional',
      0.8,
      w.superseded?.id ?? null,
      nextVersion,
    )
    created++
  }

  return { created, superseded }
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(normalizeForHashing(text)).digest('hex')
}

function normalizeForHashing(text: string): string {
  // Collapse runs of whitespace + trim — so a re-crawl that
  // re-flows whitespace doesn't trigger spurious supersessions.
  return text.replace(/\s+/g, ' ').trim()
}

async function mapWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<U>,
): Promise<U[]> {
  const out: U[] = new Array(items.length)
  let next = 0
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}
