-- ═══════════════════════════════════════════════════════════════════════════
-- Symbiosis Migration — adds fields for Emergency Pause, Working Hours,
-- Approval Queue, and Message Correction.
--
-- Safe to run multiple times (IF NOT EXISTS guards everywhere).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Workspace: Emergency Pause ─────────────────────────────────────────────
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "isPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "pausedBy" TEXT;

-- ─── Agent: Working Hours, Emergency Pause, Approval Rules ──────────────────
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workingHoursEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workingHoursStart" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workingHoursEnd" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workingDays" TEXT[] NOT NULL DEFAULT ARRAY['mon','tue','wed','thu','fri','sat','sun'];
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "isPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "pausedAt" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "requireApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "approvalRules" JSONB;

-- ─── MessageLog: Approval Queue ─────────────────────────────────────────────
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "needsApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvalReason" TEXT;

CREATE INDEX IF NOT EXISTS "MessageLog_needsApproval_approvalStatus_idx"
  ON "MessageLog"("needsApproval", "approvalStatus");

-- ─── MessageCorrection: new table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MessageCorrection" (
  "id"            TEXT PRIMARY KEY,
  "messageLogId"  TEXT NOT NULL,
  "originalText"  TEXT NOT NULL,
  "correctedText" TEXT NOT NULL,
  "correctedBy"   TEXT NOT NULL,
  "reason"        TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageCorrection_messageLogId_fkey"
    FOREIGN KEY ("messageLogId") REFERENCES "MessageLog"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "MessageCorrection_messageLogId_idx" ON "MessageCorrection"("messageLogId");
CREATE INDEX IF NOT EXISTS "MessageCorrection_correctedBy_createdAt_idx" ON "MessageCorrection"("correctedBy", "createdAt" DESC);
