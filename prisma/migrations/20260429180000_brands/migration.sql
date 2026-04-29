-- Brands — whitelabel client identity, optional. One workspace, many
-- brands. Widgets and Knowledge Collections can be tagged to a brand
-- so the inbox can filter, transcripts can be exported per-brand, and
-- per-brand knowledge stays cleanly scoped without forcing a separate
-- workspace per client.
--
-- All additive. No backfill — existing widgets/collections stay
-- untagged (brandId = NULL) and the brand UX simply doesn't surface
-- on workspaces that don't create brands.

CREATE TABLE IF NOT EXISTS "Brand" (
  "id"           TEXT PRIMARY KEY,
  "workspaceId"  TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "slug"         TEXT NOT NULL,
  "description"  TEXT,
  "logoUrl"      TEXT,
  "primaryColor" TEXT,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "Brand_workspaceId_slug_key"
  ON "Brand"("workspaceId", "slug");
CREATE INDEX IF NOT EXISTS "Brand_workspaceId_idx" ON "Brand"("workspaceId");

DO $$ BEGIN
  ALTER TABLE "Brand"
    ADD CONSTRAINT "Brand_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ChatWidget.brandId — nullable. Widgets that aren't tagged just
-- don't surface in the brand-scoped inbox views.
ALTER TABLE "ChatWidget"
  ADD COLUMN IF NOT EXISTS "brandId" TEXT;
CREATE INDEX IF NOT EXISTS "ChatWidget_brandId_idx" ON "ChatWidget"("brandId");

DO $$ BEGIN
  ALTER TABLE "ChatWidget"
    ADD CONSTRAINT "ChatWidget_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- KnowledgeCollection.brandId — nullable. Null means "shared across
-- every brand" (e.g. a Master FAQs set the operator team uses across
-- clients). Set means "scoped to this brand."
ALTER TABLE "KnowledgeCollection"
  ADD COLUMN IF NOT EXISTS "brandId" TEXT;
CREATE INDEX IF NOT EXISTS "KnowledgeCollection_brandId_idx" ON "KnowledgeCollection"("brandId");

DO $$ BEGIN
  ALTER TABLE "KnowledgeCollection"
    ADD CONSTRAINT "KnowledgeCollection_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
