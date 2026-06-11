-- Co-Pilot agents + call recordings. Idempotent.
CREATE TABLE IF NOT EXISTS "CopilotAgent" (
  "id"                 TEXT NOT NULL,
  "workspaceId"        TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "persona"            TEXT,
  "knowledgeDomainIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "steps"              JSONB NOT NULL DEFAULT '[]'::jsonb,
  "timeboxMinutes"     INTEGER NOT NULL DEFAULT 30,
  "playbook"           TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopilotAgent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CopilotAgent_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "CopilotAgent_workspaceId_idx" ON "CopilotAgent"("workspaceId");

CREATE TABLE IF NOT EXISTS "CopilotRecording" (
  "id"               TEXT NOT NULL,
  "agentId"          TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "storageKey"       TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'queued',
  "transcript"       TEXT,
  "walkthrough"      TEXT,
  "error"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopilotRecording_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CopilotRecording_agentId_fkey" FOREIGN KEY ("agentId")
    REFERENCES "CopilotAgent"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "CopilotRecording_agentId_idx" ON "CopilotRecording"("agentId");
