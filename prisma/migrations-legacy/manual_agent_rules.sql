-- ═══════════════════════════════════════════════════════════════════════════
-- AgentRule — natural-language detection rules that update contact fields
-- when the inbound message matches. Companion to QualifyingQuestion, but
-- passive (no question asked).
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "AgentRule" (
  "id"                   TEXT PRIMARY KEY,
  "agentId"              TEXT NOT NULL REFERENCES "Agent"("id") ON DELETE CASCADE,
  "name"                 TEXT NOT NULL,
  "conditionDescription" TEXT NOT NULL,
  "examples"             TEXT[] NOT NULL DEFAULT '{}',
  "targetFieldKey"       TEXT NOT NULL,
  "targetValue"          TEXT NOT NULL,
  "overwrite"            BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive"             BOOLEAN NOT NULL DEFAULT TRUE,
  "order"                INT NOT NULL DEFAULT 0,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AgentRule_agentId_isActive_order_idx"
  ON "AgentRule"("agentId", "isActive", "order");
