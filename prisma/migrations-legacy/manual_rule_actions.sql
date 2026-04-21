-- ═══════════════════════════════════════════════════════════════════════════
-- AgentRule: generalize "THEN" to support action types beyond
-- update_contact_field. Adds actionType + actionParams columns; legacy
-- rows get actionType='update_contact_field' and keep working unchanged.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "AgentRule"
  ADD COLUMN IF NOT EXISTS "actionType" TEXT NOT NULL DEFAULT 'update_contact_field';

ALTER TABLE "AgentRule"
  ADD COLUMN IF NOT EXISTS "actionParams" JSONB;

-- Existing rows were field-update rules — keep them that way. NOT NULL
-- default above does the right thing for new columns, but make it explicit
-- in case the column existed from a prior half-run.
UPDATE "AgentRule" SET "actionType" = 'update_contact_field'
  WHERE "actionType" IS NULL;
