-- ═══════════════════════════════════════════════════════════════════════════
-- Help Center — HelpCategory + HelpArticle
-- Public, crawlable help articles authored by @voxility.ai super-admins.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "HelpCategory" (
  "id"          TEXT PRIMARY KEY,
  "slug"        TEXT NOT NULL UNIQUE,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "icon"        TEXT,
  "order"       INT NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "HelpCategory_order_idx" ON "HelpCategory"("order");

CREATE TABLE IF NOT EXISTS "HelpArticle" (
  "id"          TEXT PRIMARY KEY,
  "slug"        TEXT NOT NULL UNIQUE,
  "title"       TEXT NOT NULL,
  "summary"     TEXT,
  "body"        TEXT NOT NULL,
  "videoUrl"    TEXT,
  "categoryId"  TEXT REFERENCES "HelpCategory"("id") ON DELETE SET NULL,
  "status"      TEXT NOT NULL DEFAULT 'draft',
  "publishedAt" TIMESTAMP(3),
  "authorEmail" TEXT,
  "order"       INT NOT NULL DEFAULT 0,
  "viewCount"   INT NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "HelpArticle_categoryId_order_idx" ON "HelpArticle"("categoryId", "order");
CREATE INDEX IF NOT EXISTS "HelpArticle_status_publishedAt_idx" ON "HelpArticle"("status", "publishedAt");
