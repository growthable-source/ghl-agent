-- Voice-demo prospecting funnel (hand-run; matches the DemoProspect +
-- DemoTryCall models in schema.prisma). Run once in production.

CREATE TABLE IF NOT EXISTS "DemoProspect" (
  "id"                 TEXT NOT NULL,
  "slug"               TEXT NOT NULL,
  "businessName"       TEXT NOT NULL,
  "websiteUrl"         TEXT NOT NULL,
  "websiteDomain"      TEXT NOT NULL,
  "contactEmail"       TEXT,
  "vertical"           TEXT,
  "templates"          JSONB,
  "metadata"           JSONB,
  "status"             TEXT NOT NULL DEFAULT 'registered',
  "agentId"            TEXT,
  "knowledgeDomainId"  TEXT,
  "ingestionRunId"     TEXT,
  "clickedAt"          TIMESTAMP(3),
  "firstCallAt"        TIMESTAMP(3),
  "callCount"          INTEGER NOT NULL DEFAULT 0,
  "totalCallSecs"      INTEGER NOT NULL DEFAULT 0,
  "claimedByUserId"    TEXT,
  "claimedWorkspaceId" TEXT,
  "expiresAt"          TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DemoProspect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DemoProspect_slug_key" ON "DemoProspect"("slug");
CREATE INDEX IF NOT EXISTS "DemoProspect_status_idx" ON "DemoProspect"("status");
CREATE INDEX IF NOT EXISTS "DemoProspect_websiteDomain_idx" ON "DemoProspect"("websiteDomain");
CREATE INDEX IF NOT EXISTS "DemoProspect_status_expiresAt_idx" ON "DemoProspect"("status", "expiresAt");

CREATE TABLE IF NOT EXISTS "DemoTryCall" (
  "id"         TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "ip"         TEXT NOT NULL,
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"    TIMESTAMP(3),
  "secs"       INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "DemoTryCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DemoTryCall_ip_startedAt_idx" ON "DemoTryCall"("ip", "startedAt");
CREATE INDEX IF NOT EXISTS "DemoTryCall_startedAt_endedAt_idx" ON "DemoTryCall"("startedAt", "endedAt");
CREATE INDEX IF NOT EXISTS "DemoTryCall_prospectId_idx" ON "DemoTryCall"("prospectId");

-- Cleanup for anyone who ran a pre-composite-index draft of this file;
-- no-ops on a fresh database.
DROP INDEX IF EXISTS "DemoProspect_expiresAt_idx";
DROP INDEX IF EXISTS "DemoTryCall_startedAt_idx";
