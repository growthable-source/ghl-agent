-- Canonical shared knowledge corpus.
--
-- Before: retrieval was hard-scoped to one workspace
-- (runVectorTopK: WHERE d."workspaceId" = $1). Giving N customers the
-- same help-center article set meant N copies — N x Voyage embedding
-- cost, N x chunk rows, N x recrawl cron load, and an article edit
-- reaching a customer only after THEIR workspace recrawled.
--
-- After: ONE collection carries isGlobal. Agents in other workspaces may
-- READ it, but only when it is explicitly attached to them
-- (AgentCollection) AND the retrieval SQL re-confirms kc."isGlobal" =
-- TRUE in the same statement. Everything else about the collection —
-- editing, crawling, deleting, connection management — stays scoped to
-- the owning workspace.
--
-- Safe to run BEFORE the deploy. Until the column exists,
-- globalCollectionsReady() returns false and every code path falls back
-- to today's pure workspace scoping. Nothing breaks, nothing leaks.
--
-- Safe to re-run.

-- ── 1. Columns ──────────────────────────────────────────────────────────
ALTER TABLE "KnowledgeCollection"
  ADD COLUMN IF NOT EXISTS "isGlobal" BOOLEAN NOT NULL DEFAULT false;

-- Stable handle so provisioning resolves the corpus by name rather than
-- a hardcoded cuid — it can be rebuilt or renamed without a redeploy.
ALTER TABLE "KnowledgeCollection"
  ADD COLUMN IF NOT EXISTS "globalKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeCollection_globalKey_key"
  ON "KnowledgeCollection" ("globalKey")
  WHERE "globalKey" IS NOT NULL;

-- Partial: only the handful of global rows are ever looked up this way.
CREATE INDEX IF NOT EXISTS "KnowledgeCollection_isGlobal_idx"
  ON "KnowledgeCollection" ("isGlobal")
  WHERE "isGlobal";

-- ── 2. Write guard ──────────────────────────────────────────────────────
-- The security model rests on "no application code path writes this".
-- Every route that creates or updates a collection builds an explicit
-- allowlisted `data` object, so today that holds — but it holds by
-- convention, and one careless `...body` spread would break it silently.
--
-- This trigger makes the database itself the enforcement point. The
-- pooled application connection never sets xovera.allow_global, so no
-- route, no ORM call, and no accidental spread can promote a collection
-- to global. Only a hand-run transaction that opts in explicitly can.
CREATE OR REPLACE FUNCTION "guard_knowledge_collection_isglobal"() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW."isGlobal")
     OR (TG_OP = 'UPDATE' AND NEW."isGlobal" IS DISTINCT FROM OLD."isGlobal") THEN
    IF coalesce(current_setting('xovera.allow_global', true), '') <> 'on' THEN
      RAISE EXCEPTION 'KnowledgeCollection.isGlobal is super-admin-only; SET LOCAL xovera.allow_global = ''on'' first';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "KnowledgeCollection_isglobal_guard" ON "KnowledgeCollection";
CREATE TRIGGER "KnowledgeCollection_isglobal_guard"
  BEFORE INSERT OR UPDATE ON "KnowledgeCollection"
  FOR EACH ROW EXECUTE FUNCTION "guard_knowledge_collection_isglobal"();

-- ── 3. Promoting the corpus (NOT run by this file) ──────────────────────
-- Deliberately left out: it names a real cuid, so it is a hand-run step,
-- not a committed migration. Find the collection first:
--
--   SELECT c.id, c.name, w.name AS workspace, count(s.id) AS sources
--     FROM "KnowledgeCollection" c
--     JOIN "Workspace" w ON w.id = c."workspaceId"
--     LEFT JOIN "KnowledgeSource" s ON s."collectionId" = c.id
--    WHERE w.name ILIKE '%Canonical%'
--    GROUP BY 1, 2, 3;
--
-- Then:
--
--   BEGIN;
--   SET LOCAL xovera.allow_global = 'on';
--   UPDATE "KnowledgeCollection"
--      SET "isGlobal" = true, "globalKey" = 'helpcenter-v1'
--    WHERE id = '<paste-collection-cuid>';
--   -- Sanity: exactly one row, in the corpus workspace.
--   SELECT id, name, "workspaceId", "isGlobal", "globalKey"
--     FROM "KnowledgeCollection" WHERE "isGlobal";
--   COMMIT;
--
-- Post-promotion checks live in the plan's Verification section. The
-- critical one: a global collection must own ZERO WorkspaceDataSource
-- rows, because data sources carry encrypted credentials and are handed
-- to agents as live callable tools.
