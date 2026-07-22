-- Cross-workspace knowledge collection sharing.
--
-- KnowledgeCollectionShare       — a share code/link minted for a collection.
-- KnowledgeCollectionShareImport — one redemption of that code by another workspace.
--
-- Sharing copies; nothing is live-linked. See lib/knowledge-sharing.ts.
-- Run by hand in production (Ryan), matching the manual-SQL workflow.

CREATE TABLE IF NOT EXISTS "KnowledgeCollectionShare" (
  "id"              TEXT PRIMARY KEY,
  "collectionId"    TEXT NOT NULL,
  "workspaceId"     TEXT NOT NULL,
  "code"            TEXT NOT NULL,
  "createdByUserId" TEXT,
  "note"            TEXT,
  "maxUses"         INTEGER,
  "useCount"        INTEGER NOT NULL DEFAULT 0,
  "expiresAt"       TIMESTAMP(3),
  "revokedAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeCollectionShare_code_key"
  ON "KnowledgeCollectionShare" ("code");
CREATE INDEX IF NOT EXISTS "KnowledgeCollectionShare_collectionId_idx"
  ON "KnowledgeCollectionShare" ("collectionId");
CREATE INDEX IF NOT EXISTS "KnowledgeCollectionShare_workspaceId_idx"
  ON "KnowledgeCollectionShare" ("workspaceId");

DO $$
BEGIN
  ALTER TABLE "KnowledgeCollectionShare"
    ADD CONSTRAINT "KnowledgeCollectionShare_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "KnowledgeCollectionShareImport" (
  "id"                  TEXT PRIMARY KEY,
  "shareId"             TEXT NOT NULL,
  "targetWorkspaceId"   TEXT NOT NULL,
  "createdCollectionId" TEXT,
  "importedByUserId"    TEXT,
  "entryCount"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "KnowledgeCollectionShareImport_shareId_idx"
  ON "KnowledgeCollectionShareImport" ("shareId");
CREATE INDEX IF NOT EXISTS "KnowledgeCollectionShareImport_targetWorkspaceId_idx"
  ON "KnowledgeCollectionShareImport" ("targetWorkspaceId");

DO $$
BEGIN
  ALTER TABLE "KnowledgeCollectionShareImport"
    ADD CONSTRAINT "KnowledgeCollectionShareImport_shareId_fkey"
    FOREIGN KEY ("shareId") REFERENCES "KnowledgeCollectionShare"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
