-- AgentReferenceHealth table
CREATE TABLE IF NOT EXISTS "AgentReferenceHealth" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "resourceType" TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "sourceField" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "lastCheckedAt" TIMESTAMP(3) NOT NULL,
  "lastError" TEXT,
  "firstBrokenAt" TIMESTAMP(3),
  CONSTRAINT "AgentReferenceHealth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentReferenceHealth_agentId_resourceType_resourceId_sourceField_key"
  ON "AgentReferenceHealth"("agentId", "resourceType", "resourceId", "sourceField");

CREATE INDEX IF NOT EXISTS "AgentReferenceHealth_agentId_status_idx"
  ON "AgentReferenceHealth"("agentId", "status");

-- FK — wrapped in DO block so re-runs in the Supabase SQL editor don't
-- error on duplicate constraint name (Postgres has no IF NOT EXISTS for
-- constraints).
DO $$ BEGIN
  ALTER TABLE "AgentReferenceHealth"
    ADD CONSTRAINT "AgentReferenceHealth_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Workspace.brokenReferenceMode
ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "brokenReferenceMode" TEXT NOT NULL DEFAULT 'tool_disable';
