-- AgentToolConfig table
CREATE TABLE IF NOT EXISTS "AgentToolConfig" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "toolName" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "useWhen" TEXT,
  "onFailure" TEXT NOT NULL DEFAULT 'default',
  "onFailureMessage" TEXT,
  CONSTRAINT "AgentToolConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentToolConfig_agentId_toolName_key"
  ON "AgentToolConfig"("agentId", "toolName");

CREATE INDEX IF NOT EXISTS "AgentToolConfig_agentId_idx"
  ON "AgentToolConfig"("agentId");

-- FK — wrapped in DO block so re-runs in the Supabase SQL editor don't
-- error on duplicate constraint name (Postgres has no IF NOT EXISTS for
-- constraints).
DO $$ BEGIN
  ALTER TABLE "AgentToolConfig"
    ADD CONSTRAINT "AgentToolConfig_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Agent.toolAutonomyMode
ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "toolAutonomyMode" TEXT NOT NULL DEFAULT 'guided';
