-- ═══════════════════════════════════════════════════════════════════════════
-- QualifyingQuestion: richer conditional actions
--   conditionValues  — multi-value list for the new `is_any_of` op
--   actionParams     — JSON bag for structured action parameters
--                      (workflow IDs, opportunity status/value, DND channel)
-- Legacy conditionVal / actionValue columns are kept and still honoured.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "QualifyingQuestion"
  ADD COLUMN IF NOT EXISTS "conditionValues" TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE "QualifyingQuestion"
  ADD COLUMN IF NOT EXISTS "actionParams" JSONB;
