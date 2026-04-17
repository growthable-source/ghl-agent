-- ═══════════════════════════════════════════════════════════════════════════
-- Knowledge Improvements — status tracking + recurring crawl schedules
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE "KnowledgeEntry" ADD COLUMN IF NOT EXISTS "contentHash" TEXT;
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_agentId_status_idx" ON "KnowledgeEntry"("agentId","status");

CREATE TABLE IF NOT EXISTS "CrawlSchedule" (
  "id"         TEXT PRIMARY KEY,
  "agentId"    TEXT NOT NULL,
  "url"        TEXT NOT NULL,
  "frequency"  TEXT NOT NULL,
  "isActive"   BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt"  TIMESTAMP(3),
  "nextRunAt"  TIMESTAMP(3) NOT NULL,
  "lastStatus" TEXT,
  "lastError"  TEXT,
  "newChunks"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CrawlSchedule_agentId_idx" ON "CrawlSchedule"("agentId");
CREATE INDEX IF NOT EXISTS "CrawlSchedule_isActive_nextRunAt_idx" ON "CrawlSchedule"("isActive","nextRunAt");
