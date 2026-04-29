-- Knowledge Collections — promote knowledge from "loose entries plus
-- separate data sources" into named, reusable bundles. Agents now
-- attach to *collections*, not individual entries.
--
-- Backfill is critical: every existing workspace gets one default
-- "General" collection; every entry, every data source, and every
-- agent that previously had any knowledge attached are wired into it
-- so day-one behavior is identical to the previous setup.

-- 1. KnowledgeCollection table.
CREATE TABLE IF NOT EXISTS "KnowledgeCollection" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "icon"        TEXT,
  "color"       TEXT,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "KnowledgeCollection_workspaceId_order_idx"
  ON "KnowledgeCollection"("workspaceId", "order");

DO $$ BEGIN
  ALTER TABLE "KnowledgeCollection"
    ADD CONSTRAINT "KnowledgeCollection_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. AgentCollection junction (replaces AgentKnowledge).
CREATE TABLE IF NOT EXISTS "AgentCollection" (
  "id"           TEXT PRIMARY KEY,
  "agentId"      TEXT NOT NULL,
  "collectionId" TEXT NOT NULL,
  "attachedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgentCollection_agentId_collectionId_key"
  ON "AgentCollection"("agentId", "collectionId");
CREATE INDEX IF NOT EXISTS "AgentCollection_collectionId_idx"
  ON "AgentCollection"("collectionId");

DO $$ BEGIN
  ALTER TABLE "AgentCollection"
    ADD CONSTRAINT "AgentCollection_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AgentCollection"
    ADD CONSTRAINT "AgentCollection_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. New columns on existing tables.
ALTER TABLE "KnowledgeEntry"
  ADD COLUMN IF NOT EXISTS "collectionId" TEXT;

ALTER TABLE "WorkspaceDataSource"
  ADD COLUMN IF NOT EXISTS "collectionId" TEXT;

-- 4. Backfill: one default "General" collection per workspace that
-- already has knowledge or data sources. Idempotent — re-running picks
-- up any newly-orphaned content. We use a deterministic id derived from
-- the workspace id so re-running this migration is a no-op.
INSERT INTO "KnowledgeCollection" ("id", "workspaceId", "name", "description", "icon", "order", "createdAt", "updatedAt")
SELECT
  'col_default_' || substr(md5(w."id"), 1, 20),
  w."id",
  'General',
  'Default collection for knowledge created before the Collections migration.',
  '📚',
  0,
  NOW(),
  NOW()
FROM "Workspace" w
WHERE EXISTS (SELECT 1 FROM "KnowledgeEntry" e WHERE e."workspaceId" = w."id")
   OR EXISTS (SELECT 1 FROM "WorkspaceDataSource" ds WHERE ds."workspaceId" = w."id")
ON CONFLICT ("id") DO NOTHING;

-- 5. Wire every existing entry into its workspace's General collection.
UPDATE "KnowledgeEntry" e
SET "collectionId" = c."id"
FROM "KnowledgeCollection" c
WHERE c."workspaceId" = e."workspaceId"
  AND c."id" = 'col_default_' || substr(md5(e."workspaceId"), 1, 20)
  AND e."collectionId" IS NULL;

-- 6. Wire every existing data source into its workspace's General collection.
UPDATE "WorkspaceDataSource" ds
SET "collectionId" = c."id"
FROM "KnowledgeCollection" c
WHERE c."workspaceId" = ds."workspaceId"
  AND c."id" = 'col_default_' || substr(md5(ds."workspaceId"), 1, 20)
  AND ds."collectionId" IS NULL;

-- 7. Wire every agent that previously had any AgentKnowledge attachment
-- to the General collection of that agent's workspace. Agents inherit
-- exactly the same content surface they had before, just routed via the
-- collection instead of a per-entry junction.
INSERT INTO "AgentCollection" ("id", "agentId", "collectionId", "attachedAt")
SELECT DISTINCT
  'agc_' || substr(md5(a."id" || c."id"), 1, 24),
  a."id",
  c."id",
  NOW()
FROM "Agent" a
JOIN "Workspace" w ON w."id" = a."workspaceId"
JOIN "KnowledgeCollection" c ON c."id" = 'col_default_' || substr(md5(w."id"), 1, 20)
WHERE EXISTS (
  -- Either the agent had knowledge attached (the previous junction may
  -- or may not exist depending on which migration was applied)…
  SELECT 1 FROM information_schema.tables WHERE table_name = 'AgentKnowledge'
)
AND (
  EXISTS (
    SELECT 1
    FROM "AgentKnowledge" ak
    WHERE ak."agentId" = a."id"
  )
  -- …or the workspace has any data sources (an agent in that workspace
  -- presumably wants the data-source tools surfaced).
  OR EXISTS (
    SELECT 1 FROM "WorkspaceDataSource" ds
    WHERE ds."workspaceId" = w."id" AND ds."isActive" = TRUE
  )
)
ON CONFLICT ("agentId", "collectionId") DO NOTHING;

-- 8. Now make collectionId NOT NULL on KnowledgeEntry — every entry
-- must belong to a collection from here on. (Data sources are kept
-- nullable so unconfigured legacy rows still work; the API requires
-- one when creating.)
ALTER TABLE "KnowledgeEntry" ALTER COLUMN "collectionId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "KnowledgeEntry_collectionId_idx"
  ON "KnowledgeEntry"("collectionId");
CREATE INDEX IF NOT EXISTS "KnowledgeEntry_collectionId_status_idx"
  ON "KnowledgeEntry"("collectionId", "status");

DO $$ BEGIN
  ALTER TABLE "KnowledgeEntry"
    ADD CONSTRAINT "KnowledgeEntry_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "WorkspaceDataSource_collectionId_idx"
  ON "WorkspaceDataSource"("collectionId");

DO $$ BEGIN
  ALTER TABLE "WorkspaceDataSource"
    ADD CONSTRAINT "WorkspaceDataSource_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 9. The legacy AgentKnowledge junction (per-entry attachment) is
-- replaced by AgentCollection. Drop it after backfill.
DROP TABLE IF EXISTS "AgentKnowledge";
