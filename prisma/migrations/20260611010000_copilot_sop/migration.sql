-- Co-Pilot SOPs: workspace-authored step-by-step procedures the
-- co-pilot runs with a user inside a timebox. Idempotent.
CREATE TABLE IF NOT EXISTS "CopilotSop" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "goal"           TEXT NOT NULL,
  "timeboxMinutes" INTEGER NOT NULL DEFAULT 20,
  "steps"          JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopilotSop_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CopilotSop_workspaceId_fkey" FOREIGN KEY ("workspaceId")
    REFERENCES "Workspace"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "CopilotSop_workspaceId_idx" ON "CopilotSop"("workspaceId");
