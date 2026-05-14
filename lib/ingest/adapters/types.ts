/**
 * SourceAdapter — the contract every ingest source implements.
 *
 * Three stages, intentionally separated so each source type owns its
 * fetching / extraction concerns and the shared pipeline owns the rest
 * (chunk → classify → embed → write).
 *
 *   discover(config)  → URLs / identifiers to ingest from this source
 *   fetch(item)       → raw payload (markdown, PDF bytes, transcript JSON…)
 *   normalize(raw)    → cleaned markdown + source-specific metadata
 *
 * Adding a new source type = one new file under lib/ingest/adapters/ that
 * implements this contract + a switch case in lib/ingest/pipeline.ts to
 * route on KnowledgeSource.sourceType.
 */

export interface DiscoveredItem {
  /** Stable identifier for this item — for docs: the canonical URL.
   *  For PDFs: the storage key. For YouTube: the video id. */
  identifier: string
  /** Optional adapter-supplied hint about what changed since last crawl
   *  (e.g. RSS pubDate, blog ETag). Lets the pipeline short-circuit
   *  fetch for items it can prove are unchanged. */
  changedHint?: string
}

export interface RawContent {
  identifier: string
  /** Adapter-defined payload shape. Pipeline doesn't peek inside. */
  raw: unknown
  /** Surfaced for the IngestionRun error_log if normalize() fails. */
  fetchedAt: Date
}

export interface NormalizedContent {
  identifier: string
  /** Canonical URL the chunk's deep-links point at. For docs this is
   *  the page URL; for PDFs it's the storage key (no public URL). */
  sourceUrl: string
  /** Cleaned markdown. Boilerplate stripped, anchors preserved as
   *  `[heading](#anchor)` so the chunker can split + the metadata
   *  layer can carry the anchor through. */
  markdown: string
  /** Per-adapter metadata blob carried through to KnowledgeChunk.sourceMetadata.
   *  Shape is adapter-owned; the pipeline treats it as opaque. */
  metadata: Record<string, unknown>
}

export interface AdapterContext {
  /** The KnowledgeSource row driving this ingest. Crawl config + identifier
   *  + any adapter-specific stash lives here. */
  source: {
    id: string
    sourceType: string
    urlOrIdentifier: string
    crawlConfig: Record<string, unknown>
  }
  /** Tenant scope. Adapters that hit storage or third-party APIs may
   *  need this to scope auth / quota. */
  workspaceId: string
}

export interface SourceAdapter {
  /** Stable identifier — must match KnowledgeSource.sourceType. */
  readonly sourceType: string
  discover(ctx: AdapterContext): Promise<DiscoveredItem[]>
  fetch(ctx: AdapterContext, item: DiscoveredItem): Promise<RawContent>
  normalize(ctx: AdapterContext, raw: RawContent): Promise<NormalizedContent>
}
