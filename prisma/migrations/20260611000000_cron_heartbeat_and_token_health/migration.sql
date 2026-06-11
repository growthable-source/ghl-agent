-- Stability round: cron heartbeats + dead-token flag.
-- Idempotent — safe to re-run.

-- 1. Cron heartbeat table (lib/cron-heartbeat.ts). One row per cron,
--    upserted every run; /api/admin/cron-health reads it.
CREATE TABLE IF NOT EXISTS "CronHeartbeat" (
  "name"                TEXT NOT NULL,
  "lastRunAt"           TIMESTAMP(3) NOT NULL,
  "lastSuccessAt"       TIMESTAMP(3),
  "lastError"           TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CronHeartbeat_pkey" PRIMARY KEY ("name")
);

-- 2. Dead-token flag on Location (from the prior stability commit —
--    bundled here so one paste covers both). Stamped by the
--    refresh-tokens cron on genuine invalid_grant; cleared on any
--    successful refresh or fresh OAuth. Drives the "reconnect
--    required" banner.
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "tokenRefreshFailedAt" TIMESTAMP(3);
