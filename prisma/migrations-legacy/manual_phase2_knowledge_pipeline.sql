-- ─── Phase 2: Knowledge pipeline (domains, taxonomy, sources, chunks) ──────
-- One paste-and-run block. Idempotent — safe to re-run.
--
-- Requires pgvector >= 0.5 for HNSW indexes. Supabase ships it; toggle
-- on under Database → Extensions if you haven't already.

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. KnowledgeDomain — workspace-scoped expertise pools.
CREATE TABLE IF NOT EXISTS "KnowledgeDomain" (
  "id"                TEXT PRIMARY KEY,
  "workspaceId"       TEXT NOT NULL,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "defaultIntentTags" TEXT[] NOT NULL DEFAULT '{}',
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeDomain_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeDomain_workspaceId_name_key"
  ON "KnowledgeDomain"("workspaceId","name");
CREATE INDEX IF NOT EXISTS "KnowledgeDomain_workspaceId_idx"
  ON "KnowledgeDomain"("workspaceId");

-- 2. Taxonomy — per-domain controlled vocabulary.
CREATE TABLE IF NOT EXISTS "Taxonomy" (
  "id"                TEXT PRIMARY KEY,
  "knowledgeDomainId" TEXT NOT NULL,
  "key"               TEXT NOT NULL,
  "label"             TEXT NOT NULL,
  "aliases"           TEXT[] NOT NULL DEFAULT '{}',
  "parentKey"         TEXT,
  "taxonomyVersion"   INTEGER NOT NULL DEFAULT 1,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Taxonomy_knowledgeDomainId_fkey"
    FOREIGN KEY ("knowledgeDomainId") REFERENCES "KnowledgeDomain"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "Taxonomy_knowledgeDomainId_key_key"
  ON "Taxonomy"("knowledgeDomainId","key");
CREATE INDEX IF NOT EXISTS "Taxonomy_knowledgeDomainId_parentKey_idx"
  ON "Taxonomy"("knowledgeDomainId","parentKey");

-- 3. KnowledgeSource — what to crawl / where chunks came from.
CREATE TABLE IF NOT EXISTS "KnowledgeSource" (
  "id"                TEXT PRIMARY KEY,
  "knowledgeDomainId" TEXT NOT NULL,
  "sourceType"        TEXT NOT NULL,
  "urlOrIdentifier"   TEXT NOT NULL,
  "crawlConfig"       JSONB NOT NULL DEFAULT '{}',
  "isActive"          BOOLEAN NOT NULL DEFAULT true,
  "lastCrawledAt"     TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeSource_knowledgeDomainId_fkey"
    FOREIGN KEY ("knowledgeDomainId") REFERENCES "KnowledgeDomain"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "KnowledgeSource_knowledgeDomainId_isActive_idx"
  ON "KnowledgeSource"("knowledgeDomainId","isActive");
CREATE INDEX IF NOT EXISTS "KnowledgeSource_lastCrawledAt_idx"
  ON "KnowledgeSource"("lastCrawledAt");

-- 4. IngestionRun — per-execution audit trail.
CREATE TABLE IF NOT EXISTS "IngestionRun" (
  "id"               TEXT PRIMARY KEY,
  "sourceId"         TEXT NOT NULL,
  "startedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"      TIMESTAMP(3),
  "status"           TEXT NOT NULL DEFAULT 'running',
  "pagesAttempted"   INTEGER NOT NULL DEFAULT 0,
  "pagesSucceeded"   INTEGER NOT NULL DEFAULT 0,
  "chunksCreated"    INTEGER NOT NULL DEFAULT 0,
  "chunksSuperseded" INTEGER NOT NULL DEFAULT 0,
  "errorLog"         JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "IngestionRun_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "IngestionRun_sourceId_startedAt_idx"
  ON "IngestionRun"("sourceId","startedAt" DESC);

-- 5. KnowledgeChunk — the retrieval unit. The embedding column is added
--    separately so Prisma's introspection doesn't choke on the vector type.
CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
  "id"                 TEXT PRIMARY KEY,
  "knowledgeDomainId"  TEXT NOT NULL,
  "sourceId"           TEXT NOT NULL,
  "brandIdOrigin"      TEXT,
  "visibility"         TEXT NOT NULL DEFAULT 'domain',

  "content"            TEXT NOT NULL,
  "contentHash"        TEXT NOT NULL,
  "sourceUrl"          TEXT NOT NULL,
  "sourceType"         TEXT NOT NULL,
  "sourceIdentifier"   TEXT,
  "chunkIndex"         INTEGER NOT NULL,
  "totalChunks"        INTEGER NOT NULL,
  "sourceMetadata"     JSONB NOT NULL DEFAULT '{}',

  "embeddingModel"     TEXT NOT NULL,

  "primaryTopic"       TEXT,
  "taxonomyTags"       TEXT[] NOT NULL DEFAULT '{}',
  "intentTags"         TEXT[] NOT NULL DEFAULT '{}',
  "taxonomyVersion"    INTEGER NOT NULL DEFAULT 1,

  "confidenceTier"     TEXT NOT NULL DEFAULT 'provisional',
  "qualityScore"       DOUBLE PRECISION NOT NULL DEFAULT 0.5,

  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "indexedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastVerifiedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt"         TIMESTAMP(3),
  "useCount"           INTEGER NOT NULL DEFAULT 0,

  "supersedesId"       TEXT,
  "supersededAt"       TIMESTAMP(3),
  "supersessionReason" TEXT,
  "contentVersion"     INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "KnowledgeChunk_knowledgeDomainId_fkey"
    FOREIGN KEY ("knowledgeDomainId") REFERENCES "KnowledgeDomain"("id") ON DELETE CASCADE,
  CONSTRAINT "KnowledgeChunk_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE,
  CONSTRAINT "KnowledgeChunk_supersedesId_fkey"
    FOREIGN KEY ("supersedesId") REFERENCES "KnowledgeChunk"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeChunk_sourceUrl_chunkIndex_contentVersion_key"
  ON "KnowledgeChunk"("sourceUrl","chunkIndex","contentVersion");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_knowledgeDomainId_supersededAt_idx"
  ON "KnowledgeChunk"("knowledgeDomainId","supersededAt");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_sourceId_supersededAt_idx"
  ON "KnowledgeChunk"("sourceId","supersededAt");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_contentHash_idx"
  ON "KnowledgeChunk"("contentHash");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_taxonomyVersion_idx"
  ON "KnowledgeChunk"("taxonomyVersion");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embeddingModel_idx"
  ON "KnowledgeChunk"("embeddingModel");

-- 6. Embedding column + HNSW index. Voyage-3 is 1024-dim; if you swap
--    models, add a NEW column (e.g. "embedding_3072") and migrate
--    selectively via embeddingModel filter rather than altering this.
ALTER TABLE "KnowledgeChunk"
  ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

-- HNSW index for cosine similarity. m and ef_construction are pgvector
-- defaults; tune later under measured load.
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_embedding_hnsw"
  ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "supersededAt" IS NULL;

-- 7. Sanity check.
SELECT 'KnowledgeDomain'   AS check, EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'KnowledgeDomain')   AS ok
UNION ALL SELECT 'Taxonomy',         EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Taxonomy')
UNION ALL SELECT 'KnowledgeSource',  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'KnowledgeSource')
UNION ALL SELECT 'IngestionRun',     EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'IngestionRun')
UNION ALL SELECT 'KnowledgeChunk',   EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'KnowledgeChunk')
UNION ALL SELECT 'embedding column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'KnowledgeChunk' AND column_name = 'embedding')
UNION ALL SELECT 'pgvector ext',     EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector');
