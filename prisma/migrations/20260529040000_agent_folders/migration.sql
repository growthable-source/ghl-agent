-- Agent folders: operator-defined grouping for the workspace's agents.
-- Mirrors the WidgetFolder pattern (workspace-scoped, flat, SetNull on
-- delete so children survive). Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "AgentFolder" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "color" TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentFolder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AgentFolder_workspaceId_order_idx"
  ON "AgentFolder"("workspaceId", "order");

DO $$ BEGIN
  ALTER TABLE "AgentFolder"
    ADD CONSTRAINT "AgentFolder_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- folderId on Agent — nullable; agents not in a folder render at the
-- top level of the list. SetNull so deleting a folder doesn't cascade
-- and nuke every agent inside it.
ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "folderId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Agent"
    ADD CONSTRAINT "Agent_folderId_fkey"
    FOREIGN KEY ("folderId") REFERENCES "AgentFolder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Agent_workspaceId_folderId_idx"
  ON "Agent"("workspaceId", "folderId");
