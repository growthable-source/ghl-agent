-- Visual Workflow Canvas (Phase Adv-1)
-- Per-agent node position overrides + agent viewMode.
-- Idempotent; safe to re-run.

CREATE TABLE IF NOT EXISTS "AgentNodeLayout" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "nodeKey" TEXT NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentNodeLayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentNodeLayout_agentId_nodeKey_key"
  ON "AgentNodeLayout"("agentId", "nodeKey");

CREATE INDEX IF NOT EXISTS "AgentNodeLayout_agentId_idx"
  ON "AgentNodeLayout"("agentId");

DO $$ BEGIN
  ALTER TABLE "AgentNodeLayout"
    ADD CONSTRAINT "AgentNodeLayout_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "viewMode" TEXT NOT NULL DEFAULT 'simple';
