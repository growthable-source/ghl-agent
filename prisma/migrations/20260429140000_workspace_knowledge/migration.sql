-- Promote KnowledgeEntry from per-agent to workspace-scoped, with a
-- many-to-many junction (AgentKnowledge) connecting agents to the
-- entries they "stack." Backfill is critical: every existing row
-- inherits its workspace from its agent, and gets a junction row to
-- preserve the current attachment so prompt-build behavior is identical
-- on day-one after this lands.

-- 1. New column on KnowledgeEntry — nullable while we backfill.
ALTER TABLE "KnowledgeEntry"
  ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

-- 2. Backfill workspaceId from the current creator agent.
-- Path 1: agent.workspaceId is set directly.
UPDATE "KnowledgeEntry" e
SET "workspaceId" = a."workspaceId"
FROM "Agent" a
WHERE e."agentId" = a."id"
  AND a."workspaceId" IS NOT NULL
  AND e."workspaceId" IS NULL;

-- Path 2: fall back through location → workspace for legacy agents that
-- never had agent.workspaceId backfilled.
UPDATE "KnowledgeEntry" e
SET "workspaceId" = l."workspaceId"
FROM "Agent" a
JOIN "Location" l ON l."id" = a."locationId"
WHERE e."agentId" = a."id"
  AND e."workspaceId" IS NULL;

-- 3. Drop any orphaned entries (no resolvable workspace). Loud-fail
-- alternative: leave them and refuse to enforce NOT NULL. We delete
-- because a knowledge entry with no workspace can't be displayed
-- anywhere meaningful in the new UI.
DELETE FROM "KnowledgeEntry" WHERE "workspaceId" IS NULL;

-- 4. Now make workspaceId required + indexed + FK'd to Workspace.
ALTER TABLE "KnowledgeEntry" ALTER COLUMN "workspaceId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "KnowledgeEntry_workspaceId_idx"
  ON "KnowledgeEntry"("workspaceId");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_workspaceId_status_idx"
  ON "KnowledgeEntry"("workspaceId", "status");

DO $$ BEGIN
  ALTER TABLE "KnowledgeEntry"
    ADD CONSTRAINT "KnowledgeEntry_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. agentId is now nullable. Old FK was ON DELETE CASCADE — change to
-- SET NULL so deleting the originating agent only orphans the creator
-- pointer; the entry survives in the workspace pool.
ALTER TABLE "KnowledgeEntry" ALTER COLUMN "agentId" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "KnowledgeEntry" DROP CONSTRAINT IF EXISTS "KnowledgeEntry_agentId_fkey";
EXCEPTION WHEN undefined_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "KnowledgeEntry"
    ADD CONSTRAINT "KnowledgeEntry_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 6. New junction table for many-to-many attachment.
CREATE TABLE IF NOT EXISTS "AgentKnowledge" (
  "id"               TEXT PRIMARY KEY,
  "agentId"          TEXT NOT NULL,
  "knowledgeEntryId" TEXT NOT NULL,
  "attachedAt"       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentKnowledge_agentId_knowledgeEntryId_key"
  ON "AgentKnowledge"("agentId", "knowledgeEntryId");
CREATE INDEX IF NOT EXISTS "AgentKnowledge_knowledgeEntryId_idx"
  ON "AgentKnowledge"("knowledgeEntryId");

DO $$ BEGIN
  ALTER TABLE "AgentKnowledge"
    ADD CONSTRAINT "AgentKnowledge_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AgentKnowledge"
    ADD CONSTRAINT "AgentKnowledge_knowledgeEntryId_fkey"
    FOREIGN KEY ("knowledgeEntryId") REFERENCES "KnowledgeEntry"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 7. Backfill junction rows so every existing entry stays attached to
-- its current agent. Without this, day-one of the new code would yield
-- empty knowledge blocks for every agent. Idempotent via the UNIQUE.
INSERT INTO "AgentKnowledge" ("id", "agentId", "knowledgeEntryId", "attachedAt")
SELECT
  'agk_' || substr(md5(random()::text || e."id" || e."agentId"), 1, 24),
  e."agentId",
  e."id",
  e."createdAt"
FROM "KnowledgeEntry" e
WHERE e."agentId" IS NOT NULL
ON CONFLICT ("agentId", "knowledgeEntryId") DO NOTHING;
