-- Voxility "Manus-style" build loop: render → critique → patch → repeat.
--
-- Adds two tables (LandingPageBuild, BuildIteration) and two columns on
-- Campaign for the implicit brand-vision pipeline output. Strictly
-- additive; idempotent — safe to re-run.

-- ─── Campaign: persist brand-scrape vision output ───────────────────
DO $$ BEGIN
  ALTER TABLE "Campaign" ADD COLUMN "brandScreenshotUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign" ADD COLUMN "brandAnalysis" JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ─── LandingPageBuild ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LandingPageBuild" (
  "id"              TEXT PRIMARY KEY,
  "workspaceId"     TEXT NOT NULL,
  "campaignId"      TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'queued',
  "maxIterations"   INTEGER NOT NULL DEFAULT 5,
  "scoreThreshold"  DOUBLE PRECISION NOT NULL DEFAULT 8.0,
  "bestScore"       DOUBLE PRECISION,
  "bestIterationId" TEXT,
  "error"           TEXT,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"     TIMESTAMP(3)
);

DO $$ BEGIN
  ALTER TABLE "LandingPageBuild"
    ADD CONSTRAINT "LandingPageBuild_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "LandingPageBuild_campaignId_startedAt_idx"
  ON "LandingPageBuild" ("campaignId", "startedAt" DESC);

CREATE INDEX IF NOT EXISTS "LandingPageBuild_workspaceId_status_idx"
  ON "LandingPageBuild" ("workspaceId", "status");

-- ─── BuildIteration ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BuildIteration" (
  "id"            TEXT PRIMARY KEY,
  "buildId"       TEXT NOT NULL,
  "iteration"     INTEGER NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'rendering',
  "screenshotUrl" TEXT,
  "critique"      JSONB,
  "score"         DOUBLE PRECISION,
  "specSnapshot"  JSONB,
  "error"         TEXT,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"   TIMESTAMP(3)
);

DO $$ BEGIN
  ALTER TABLE "BuildIteration"
    ADD CONSTRAINT "BuildIteration_buildId_fkey"
    FOREIGN KEY ("buildId") REFERENCES "LandingPageBuild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "BuildIteration_buildId_iteration_key"
  ON "BuildIteration" ("buildId", "iteration");

CREATE INDEX IF NOT EXISTS "BuildIteration_buildId_iteration_idx"
  ON "BuildIteration" ("buildId", "iteration");
