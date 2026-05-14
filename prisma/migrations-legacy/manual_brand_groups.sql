-- ─── Brand priority groups ──────────────────────────────────────────────────
-- Workspaces can sort brands into named priority groups (e.g. "VIP",
-- "Standard", "Low priority"). The inbox surfaces conversations from
-- higher-priority brand groups first when humans are needed.
--
-- Brand.brandGroupId is nullable — brands without a group fall through to
-- the lowest priority tier on sort.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS "BrandGroup" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "priority"    INTEGER NOT NULL DEFAULT 100,
  "color"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandGroup_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BrandGroup_workspaceId_name_key"
  ON "BrandGroup" ("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "BrandGroup_workspaceId_priority_idx"
  ON "BrandGroup" ("workspaceId", "priority");

ALTER TABLE "Brand"
  ADD COLUMN IF NOT EXISTS "brandGroupId" TEXT;

-- SetNull on group delete: brands survive group deletion (just go ungrouped).
ALTER TABLE "Brand"
  DROP CONSTRAINT IF EXISTS "Brand_brandGroupId_fkey";
ALTER TABLE "Brand"
  ADD CONSTRAINT "Brand_brandGroupId_fkey"
    FOREIGN KEY ("brandGroupId") REFERENCES "BrandGroup"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "Brand_brandGroupId_idx"
  ON "Brand" ("brandGroupId");
