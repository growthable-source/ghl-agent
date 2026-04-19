-- ═══════════════════════════════════════════════════════════════════════════
-- AgentListeningRule + ContactMemory.categories
--
-- Listening rules are user-declared categories the agent listens for without
-- asking. When matched, the agent writes into ContactMemory.categories (a
-- JSON bag keyed by rule name) rather than updating a CRM field.
--
-- Also relaxes ContactMemory.summary to nullable so category-only updates
-- don't require first generating a summary.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "AgentListeningRule" (
  "id"          TEXT PRIMARY KEY,
  "agentId"     TEXT NOT NULL REFERENCES "Agent"("id") ON DELETE CASCADE,
  "name"        TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "examples"    TEXT[] NOT NULL DEFAULT '{}',
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "order"       INT NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AgentListeningRule_agentId_isActive_order_idx"
  ON "AgentListeningRule"("agentId", "isActive", "order");

ALTER TABLE "ContactMemory" ADD COLUMN IF NOT EXISTS "categories" JSONB;

-- Make summary nullable so new memories that start with category-only data
-- don't fail the NOT NULL check. Existing rows stay populated.
ALTER TABLE "ContactMemory" ALTER COLUMN "summary" DROP NOT NULL;
