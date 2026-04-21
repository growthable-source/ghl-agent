-- ============================================================================
-- Migration: Add billing, usage tracking, and plan gating fields
-- Run this against your Supabase database via SQL Editor
--
-- Safe to re-run — all statements are idempotent (IF NOT EXISTS / IF EXISTS).
-- ============================================================================

-- 1. Update existing column defaults to match new plan tiers
--    "plan" already exists (default 'free') — change default to 'trial'
ALTER TABLE "Workspace" ALTER COLUMN "plan" SET DEFAULT 'trial';
ALTER TABLE "Workspace" ALTER COLUMN "agentLimit" SET DEFAULT 3;
ALTER TABLE "Workspace" ALTER COLUMN "messageLimit" SET DEFAULT 1500;

-- 2. Migrate existing 'free' plan rows to 'trial'
UPDATE "Workspace" SET "plan" = 'trial' WHERE "plan" = 'free';

-- 3. Add new billing columns (IF NOT EXISTS — safe to re-run)
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "planSelectedDuringTrial" TEXT;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "billingPeriod" TEXT NOT NULL DEFAULT 'monthly';
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "messageUsage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "voiceMinuteLimit" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "voiceMinuteUsage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "extraAgentCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3);

-- 4. Create UsageRecord table
CREATE TABLE IF NOT EXISTS "UsageRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "agentId" TEXT,
    "billingPeriod" TEXT NOT NULL,
    "stripeUsageRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- 5. Create indexes on UsageRecord
CREATE INDEX IF NOT EXISTS "UsageRecord_workspaceId_billingPeriod_idx"
    ON "UsageRecord"("workspaceId", "billingPeriod");

CREATE INDEX IF NOT EXISTS "UsageRecord_workspaceId_type_createdAt_idx"
    ON "UsageRecord"("workspaceId", "type", "createdAt");

-- 6. Add foreign key constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'UsageRecord_workspaceId_fkey'
    ) THEN
        ALTER TABLE "UsageRecord"
            ADD CONSTRAINT "UsageRecord_workspaceId_fkey"
            FOREIGN KEY ("workspaceId")
            REFERENCES "Workspace"("id")
            ON DELETE CASCADE
            ON UPDATE CASCADE;
    END IF;
END$$;

-- 7. Set trial end dates for existing workspaces (7 days from now)
UPDATE "Workspace"
SET "trialEndsAt" = NOW() + INTERVAL '7 days'
WHERE "trialEndsAt" IS NULL
  AND "plan" = 'trial'
  AND "stripeSubscriptionId" IS NULL;

-- 8. Update agentLimit for existing trial workspaces to the new default of 3
UPDATE "Workspace"
SET "agentLimit" = 3
WHERE "agentLimit" = 1
  AND "plan" = 'trial'
  AND "stripeSubscriptionId" IS NULL;
