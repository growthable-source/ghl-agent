-- ═══════════════════════════════════════════════════════════════════════════
-- Agent Objectives — extends AgentGoal with behavioural fields so the agent
-- actively pursues goals (not just tracks wins).
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "isPrimary"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "priority"       INTEGER NOT NULL DEFAULT 10;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "aggressiveness" TEXT    NOT NULL DEFAULT 'moderate';
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "triggerPhrases" TEXT[]  NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "preferredTool"  TEXT;
ALTER TABLE "AgentGoal" ADD COLUMN IF NOT EXISTS "instruction"    TEXT;

CREATE INDEX IF NOT EXISTS "AgentGoal_agentId_isPrimary_priority_idx"
  ON "AgentGoal"("agentId","isPrimary","priority");
