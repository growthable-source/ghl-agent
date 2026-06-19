-- Conversation Q&A Mining — hand-run DDL (Ryan applies in production).
-- Matches the ConversationMiningRun + MinedQaPair models added to
-- prisma/schema.prisma on 2026-06-19. No Prisma migration file is created,
-- so the build's `prisma migrate deploy` stays a no-op for this change.
--
-- FK columns are plain scalars in the Prisma schema; the constraints +
-- ON DELETE CASCADE live here (job/staging tables, parent models untouched).

CREATE TABLE IF NOT EXISTS "ConversationMiningRun" (
  "id"                   TEXT NOT NULL,
  "workspaceId"          TEXT NOT NULL,
  "agentId"              TEXT NOT NULL,
  "collectionId"         TEXT NOT NULL,
  "status"               TEXT NOT NULL DEFAULT 'queued',
  "windowStart"          TIMESTAMP(3) NOT NULL,
  "windowEnd"            TIMESTAMP(3) NOT NULL,
  "maxConversations"     INTEGER NOT NULL DEFAULT 2000,
  "model"                TEXT NOT NULL DEFAULT 'auto',
  "cursor"               TEXT,
  "conversationsScanned" INTEGER NOT NULL DEFAULT 0,
  "pairsGenerated"       INTEGER NOT NULL DEFAULT 0,
  "estimatedTokens"      INTEGER NOT NULL DEFAULT 0,
  "actualTokens"         INTEGER NOT NULL DEFAULT 0,
  "error"                TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMiningRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ConversationMiningRun_status_createdAt_idx"
  ON "ConversationMiningRun" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ConversationMiningRun_workspaceId_idx"
  ON "ConversationMiningRun" ("workspaceId");
CREATE INDEX IF NOT EXISTS "ConversationMiningRun_collectionId_idx"
  ON "ConversationMiningRun" ("collectionId");

CREATE TABLE IF NOT EXISTS "MinedQaPair" (
  "id"                   TEXT NOT NULL,
  "runId"                TEXT NOT NULL,
  "workspaceId"          TEXT NOT NULL,
  "collectionId"         TEXT NOT NULL,
  "question"             TEXT NOT NULL,
  "answer"               TEXT NOT NULL,
  "sourceConversationId" TEXT,
  "sourceSnippet"        TEXT,
  "confidence"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"               TEXT NOT NULL DEFAULT 'pending',
  "knowledgeEntryId"     TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MinedQaPair_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MinedQaPair_collectionId_status_idx"
  ON "MinedQaPair" ("collectionId", "status");
CREATE INDEX IF NOT EXISTS "MinedQaPair_runId_idx"
  ON "MinedQaPair" ("runId");
CREATE INDEX IF NOT EXISTS "MinedQaPair_workspaceId_idx"
  ON "MinedQaPair" ("workspaceId");

-- Foreign keys with cascade. (Run after the tables exist; safe to re-run
-- only if you guard for existing constraints — Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS, so apply once.)
ALTER TABLE "ConversationMiningRun"
  ADD CONSTRAINT "ConversationMiningRun_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMiningRun"
  ADD CONSTRAINT "ConversationMiningRun_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMiningRun"
  ADD CONSTRAINT "ConversationMiningRun_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MinedQaPair"
  ADD CONSTRAINT "MinedQaPair_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ConversationMiningRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MinedQaPair"
  ADD CONSTRAINT "MinedQaPair_collectionId_fkey"
  FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MinedQaPair"
  ADD CONSTRAINT "MinedQaPair_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
