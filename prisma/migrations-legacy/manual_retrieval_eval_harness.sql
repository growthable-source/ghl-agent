-- ─── Retrieval eval harness ─────────────────────────────────────────────
-- Curated sets of (query, expected answer) pairs that an operator runs
-- against the live retrieval stack. The system captures top-K chunks
-- per query as a frozen snapshot; operators label each chunk
-- helpful/neutral/harmful; net@K + coverage@K roll up automatically.
--
-- Safe to re-run.

-- 1. RetrievalEvalSet — workspace-scoped collection of eval queries.
CREATE TABLE IF NOT EXISTS "RetrievalEvalSet" (
  "id"                TEXT PRIMARY KEY,
  "workspaceId"       TEXT NOT NULL,
  "knowledgeDomainId" TEXT,
  "name"              TEXT NOT NULL,
  "description"       TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetrievalEvalSet_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE,
  CONSTRAINT "RetrievalEvalSet_knowledgeDomainId_fkey"
    FOREIGN KEY ("knowledgeDomainId") REFERENCES "KnowledgeDomain"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "RetrievalEvalSet_workspaceId_name_key"
  ON "RetrievalEvalSet" ("workspaceId","name");
CREATE INDEX IF NOT EXISTS "RetrievalEvalSet_workspaceId_idx"
  ON "RetrievalEvalSet" ("workspaceId");

-- 2. RetrievalEvalQuery — one labelled (query, expected) pair.
CREATE TABLE IF NOT EXISTS "RetrievalEvalQuery" (
  "id"             TEXT PRIMARY KEY,
  "evalSetId"      TEXT NOT NULL,
  "query"          TEXT NOT NULL,
  "expectedAnswer" TEXT NOT NULL,
  "brandId"        TEXT,
  "intentTags"     TEXT[] NOT NULL DEFAULT '{}',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetrievalEvalQuery_evalSetId_fkey"
    FOREIGN KEY ("evalSetId") REFERENCES "RetrievalEvalSet"("id") ON DELETE CASCADE,
  CONSTRAINT "RetrievalEvalQuery_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "RetrievalEvalQuery_evalSetId_idx"
  ON "RetrievalEvalQuery" ("evalSetId");
CREATE INDEX IF NOT EXISTS "RetrievalEvalQuery_brandId_idx"
  ON "RetrievalEvalQuery" ("brandId");

-- 3. RetrievalEvalRun — one execution of an eval set.
CREATE TABLE IF NOT EXISTS "RetrievalEvalRun" (
  "id"            TEXT PRIMARY KEY,
  "evalSetId"     TEXT NOT NULL,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"   TIMESTAMP(3),
  "status"        TEXT NOT NULL DEFAULT 'running',
  "config"        JSONB NOT NULL,
  "rubricVersion" TEXT,
  "summary"       JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "RetrievalEvalRun_evalSetId_fkey"
    FOREIGN KEY ("evalSetId") REFERENCES "RetrievalEvalSet"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "RetrievalEvalRun_evalSetId_startedAt_idx"
  ON "RetrievalEvalRun" ("evalSetId","startedAt" DESC);

-- 4. RetrievalEvalResult — per-query snapshot for a run.
CREATE TABLE IF NOT EXISTS "RetrievalEvalResult" (
  "id"              TEXT PRIMARY KEY,
  "runId"           TEXT NOT NULL,
  "queryId"         TEXT NOT NULL,
  "retrievedChunks" JSONB NOT NULL,
  "labels"          JSONB NOT NULL DEFAULT '{}',
  "netAtK"          DOUBLE PRECISION,
  "coverageAtK"     DOUBLE PRECISION,
  CONSTRAINT "RetrievalEvalResult_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "RetrievalEvalRun"("id") ON DELETE CASCADE,
  CONSTRAINT "RetrievalEvalResult_queryId_fkey"
    FOREIGN KEY ("queryId") REFERENCES "RetrievalEvalQuery"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "RetrievalEvalResult_runId_queryId_key"
  ON "RetrievalEvalResult" ("runId","queryId");
CREATE INDEX IF NOT EXISTS "RetrievalEvalResult_runId_idx"
  ON "RetrievalEvalResult" ("runId");

-- 5. KnowledgeChunkEvalRef — join from result to live chunk rows.
CREATE TABLE IF NOT EXISTS "KnowledgeChunkEvalRef" (
  "id"       TEXT PRIMARY KEY,
  "resultId" TEXT NOT NULL,
  "chunkId"  TEXT NOT NULL,
  "rank"     INTEGER NOT NULL,
  CONSTRAINT "KnowledgeChunkEvalRef_resultId_fkey"
    FOREIGN KEY ("resultId") REFERENCES "RetrievalEvalResult"("id") ON DELETE CASCADE,
  CONSTRAINT "KnowledgeChunkEvalRef_chunkId_fkey"
    FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeChunkEvalRef_resultId_chunkId_key"
  ON "KnowledgeChunkEvalRef" ("resultId","chunkId");
CREATE INDEX IF NOT EXISTS "KnowledgeChunkEvalRef_chunkId_idx"
  ON "KnowledgeChunkEvalRef" ("chunkId");
