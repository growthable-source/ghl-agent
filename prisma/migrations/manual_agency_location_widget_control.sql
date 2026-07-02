-- Manual migration: per-location widget control (agency-level connection)
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (loose .sql — not auto-applied by migrate deploy).
-- Two NEW tables, no changes to existing tables:
--   AgencyConnection — workspace-level LeadConnector agency OAuth (a separate
--                      marketplace app from the per-location install infra)
--   AgencyLocation   — synced snapshot of every location in the agency, with
--                      the per-location widgetEnabled kill switch
-- Additive only — safe to run anytime. Existing widgets are unaffected: the
-- widget config API only consults AgencyLocation when an embed explicitly
-- sends a locationId, and falls open on any miss.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AgencyConnection" (
    "id"                   TEXT NOT NULL,
    "workspaceId"          TEXT NOT NULL,
    "provider"             TEXT NOT NULL DEFAULT 'leadconnector',
    "companyId"            TEXT NOT NULL,
    "accessToken"          TEXT NOT NULL,
    "refreshToken"         TEXT NOT NULL,
    "expiresAt"            TIMESTAMP(3) NOT NULL,
    "scope"                TEXT NOT NULL,
    "tokenRefreshFailedAt" TIMESTAMP(3),
    "connectedByUserId"    TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgencyConnection_workspaceId_companyId_key"
    ON "AgencyConnection"("workspaceId", "companyId");

ALTER TABLE "AgencyConnection"
    ADD CONSTRAINT "AgencyConnection_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "AgencyLocation" (
    "id"                     TEXT NOT NULL,
    "connectionId"           TEXT NOT NULL,
    "locationId"             TEXT NOT NULL,
    "name"                   TEXT NOT NULL,
    "city"                   TEXT,
    "state"                  TEXT,
    "country"                TEXT,
    "email"                  TEXT,
    "phone"                  TEXT,
    "widgetEnabled"          BOOLEAN NOT NULL DEFAULT true,
    "widgetEnabledUpdatedAt" TIMESTAMP(3),
    "widgetEnabledUpdatedBy" TEXT,
    "lastSyncedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt"              TIMESTAMP(3),
    "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"              TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyLocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgencyLocation_connectionId_locationId_key"
    ON "AgencyLocation"("connectionId", "locationId");

CREATE INDEX IF NOT EXISTS "AgencyLocation_locationId_idx"
    ON "AgencyLocation"("locationId");

ALTER TABLE "AgencyLocation"
    ADD CONSTRAINT "AgencyLocation_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "AgencyConnection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
