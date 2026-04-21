-- ═══════════════════════════════════════════════════════════════════════════
-- StopCondition: add SENTIMENT type + per-condition action columns
-- (tagNeedsAttention, enrollWorkflowId, removeWorkflowId).
--
-- The new SENTIMENT conditionType matches hostile / angry / threatening
-- language in inbound messages — either via a built-in regex or via
-- operator-supplied extra keywords in `value`. When tripped, it pauses
-- the agent and runs whichever side-effects are configured on the row.
--
-- Existing rows get sane defaults:
--   - tagNeedsAttention defaults TRUE (surfacing flagged conversations is
--     the whole point of the Needs Attention page)
--   - enrollWorkflowId / removeWorkflowId default NULL (no action)
--
-- Idempotent. Postgres requires the enum addition to run outside a txn
-- with other DDL when ADD VALUE is the first time — split into two
-- statements so a partial re-run still converges.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TYPE "StopConditionType" ADD VALUE IF NOT EXISTS 'SENTIMENT';

ALTER TABLE "StopCondition"
  ADD COLUMN IF NOT EXISTS "tagNeedsAttention" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "StopCondition"
  ADD COLUMN IF NOT EXISTS "enrollWorkflowId" TEXT;

ALTER TABLE "StopCondition"
  ADD COLUMN IF NOT EXISTS "removeWorkflowId" TEXT;
