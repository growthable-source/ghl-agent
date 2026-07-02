-- Manual migration: per-location widget control (agency connection PER WIDGET)
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (loose .sql — not auto-applied by migrate deploy).
--
-- v2 (2026-07-02): hierarchy corrected — ONE WIDGET connects to ONE AGENCY.
-- AgencyConnection is keyed by widgetId (unique) instead of workspace-level.
-- If you already ran v1 of this file, the DROPs below discard those empty
-- tables and recreate them with the new shape. No feature ever wrote data
-- to the v1 tables (the connect flow 404'd before any insert), so the DROPs
-- are safe. If you never ran v1, the DROPs are no-ops.
--
-- Two NEW tables, no changes to existing tables:
--   AgencyConnection — per-widget LeadConnector agency OAuth (a separate
--                      marketplace app from the per-location install infra);
--                      workspaceId denormalized from the widget for scoping
--   AgencyLocation   — synced snapshot of every location in the agency, with
--                      the per-location widgetEnabled kill switch
-- Existing widgets are unaffected: the widget config API only consults
-- AgencyLocation when an embed explicitly sends a locationId, and falls
-- open on any miss.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS "AgencyLocation";
DROP TABLE IF EXISTS "AgencyConnection";

CREATE TABLE "AgencyConnection" (
    "id"                   TEXT NOT NULL,
    "widgetId"             TEXT NOT NULL,
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

CREATE UNIQUE INDEX "AgencyConnection_widgetId_key"
    ON "AgencyConnection"("widgetId");

CREATE INDEX "AgencyConnection_workspaceId_idx"
    ON "AgencyConnection"("workspaceId");

ALTER TABLE "AgencyConnection"
    ADD CONSTRAINT "AgencyConnection_widgetId_fkey"
    FOREIGN KEY ("widgetId") REFERENCES "ChatWidget"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgencyConnection"
    ADD CONSTRAINT "AgencyConnection_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AgencyLocation" (
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

CREATE UNIQUE INDEX "AgencyLocation_connectionId_locationId_key"
    ON "AgencyLocation"("connectionId", "locationId");

CREATE INDEX "AgencyLocation_locationId_idx"
    ON "AgencyLocation"("locationId");

ALTER TABLE "AgencyLocation"
    ADD CONSTRAINT "AgencyLocation_connectionId_fkey"
    FOREIGN KEY ("connectionId") REFERENCES "AgencyConnection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
