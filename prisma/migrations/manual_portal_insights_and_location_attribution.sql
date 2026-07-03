-- Manual migration: conversation location attribution + portal AI insights
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (loose .sql — not auto-applied by migrate deploy).
--
-- 1. WidgetConversation.locationId — which CRM sub-account a chat came from
--    (data-location-id on the embed, stamped at conversation create).
--    Nullable; historical rows stay NULL. Powers the portal's
--    chats-per-sub-account panel, forward-only from deploy.
-- 2. PortalInsight — one cached AI-insights synthesis per portal
--    (on-demand generation with staleness refresh, no cron).
--
-- Additive only — safe to run anytime. Code degrades gracefully until run.
-- ---------------------------------------------------------------------------

ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "locationId" TEXT;

CREATE INDEX IF NOT EXISTS "WidgetConversation_widgetId_locationId_idx"
    ON "WidgetConversation"("widgetId", "locationId");

CREATE TABLE IF NOT EXISTS "PortalInsight" (
    "id"          TEXT NOT NULL,
    "portalId"    TEXT NOT NULL,
    "content"     JSONB NOT NULL,
    "windowDays"  INTEGER NOT NULL DEFAULT 7,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalInsight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PortalInsight_portalId_key"
    ON "PortalInsight"("portalId");

ALTER TABLE "PortalInsight"
    ADD CONSTRAINT "PortalInsight_portalId_fkey"
    FOREIGN KEY ("portalId") REFERENCES "Portal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Scheduled portal email reports (same file — run together):
--    Portal.reportFrequency 'off'|'daily'|'weekly' + last-sent marker.

ALTER TABLE "Portal" ADD COLUMN IF NOT EXISTS "reportFrequency" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "Portal" ADD COLUMN IF NOT EXISTS "reportLastSentAt" TIMESTAMP(3);
