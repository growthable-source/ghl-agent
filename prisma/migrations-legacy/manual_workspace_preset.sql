-- Workspace-defined agent presets.
-- Extends the hardcoded preset registry at lib/agent/presets.ts with
-- user-saved templates. Applied through the same apply-preset code
-- path as the hardcoded ones (see applyPresetWithWorkspaceLookup).
--
-- toolDeltas is JSONB rather than a child table because the array is
-- read-as-a-whole on every apply and never queried piecemeal.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS "WorkspacePreset" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "autonomyMode" TEXT NOT NULL DEFAULT 'guided',
  "toolDeltas" JSONB NOT NULL DEFAULT '[]',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspacePreset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "WorkspacePreset_workspaceId_idx"
  ON "WorkspacePreset"("workspaceId");

DO $$ BEGIN
  ALTER TABLE "WorkspacePreset"
    ADD CONSTRAINT "WorkspacePreset_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
