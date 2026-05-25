-- manual_marketplace_installs.sql
--
-- Lead-tracking snapshot of every marketplace install. One row per
-- install event; survives Workspace/Location disconnect so we keep
-- the lead record. Driven by /api/auth/callback (and any future
-- Shopify/HubSpot marketplace handlers).

CREATE TABLE IF NOT EXISTS "MarketplaceInstall" (
  "id"               TEXT NOT NULL PRIMARY KEY,
  "workspaceId"      TEXT NOT NULL,
  "source"           TEXT NOT NULL,
  "installedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "externalLocationId" TEXT,
  "externalCompanyId"  TEXT,
  "externalUserId"     TEXT,

  "locationName"     TEXT,
  "locationEmail"    TEXT,
  "locationPhone"    TEXT,
  "locationWebsite"  TEXT,
  "locationAddress"  TEXT,
  "locationCity"     TEXT,
  "locationState"    TEXT,
  "locationCountry"  TEXT,
  "locationTimezone" TEXT,

  "companyName"      TEXT,
  "companyEmail"     TEXT,
  "companyPhone"     TEXT,
  "companyWebsite"   TEXT,

  "userName"         TEXT,
  "userEmail"        TEXT,
  "userPhone"        TEXT,
  "userRole"         TEXT,

  "contactedAt"      TIMESTAMP(3),
  "syncedToGhlAt"    TIMESTAMP(3),
  "notes"            TEXT,

  "rawPayload"       JSONB,

  CONSTRAINT "MarketplaceInstall_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "MarketplaceInstall_workspaceId_idx"
  ON "MarketplaceInstall"("workspaceId");
CREATE INDEX IF NOT EXISTS "MarketplaceInstall_installedAt_idx"
  ON "MarketplaceInstall"("installedAt");
CREATE INDEX IF NOT EXISTS "MarketplaceInstall_source_installedAt_idx"
  ON "MarketplaceInstall"("source", "installedAt");
