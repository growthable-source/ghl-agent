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
}

interface ErrorEntry {
  url: string
  stage: 'discover' | 'fetch' | 'normalize' | 'chunk' | 'classify' | 'embed' | 'write'
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

  try {
    const discovered = await adapter.discover(ctx).catch(err => {
      errors.push({ url: source.urlOrIdentifier, stage: 'discover', message: err?.message ?? 'unknown', ts: new Date().toISOString() })
      return [] as Awaited<ReturnType<SourceAdapter['discover']>>
    })

    // Tell the client how many pages we found so it can render a
    // progress bar with the right total.
    await (db as any).ingestionRun.update({
      where: { id: run.id },
      data: { pagesAttempted: discovered.length },
    }).catch(() => {})

    for (const item of discovered) {
      if (opts.deadlineAt && Date.now() > opts.deadlineAt) {
        deadlineExhausted = true
        console.log(`[ingest] soft deadline hit after ${pagesAttempted}/${discovered.length} pages — continuation will resume`)
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

  // Existing chunks for this URL that aren't superseded.
  const existing: Array<{
    id: string
    chunkIndex: number
    contentHash: string
    contentVersion: number
  }> = await (db as any).knowledgeChunk.findMany({
    where: { sourceUrl: normalized.sourceUrl, supersededAt: null },
    select: { id: true, chunkIndex: true, contentHash: true, contentVersion: true },
  })
  const existingByIndex = new Map(existing.map(c => [c.chunkIndex, c]))

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
    const nextVersion = (w.superseded?.contentVersion ?? 0) + 1
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
