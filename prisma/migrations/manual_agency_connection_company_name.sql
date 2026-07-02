-- Manual migration: agency display name on the widget's agency connection
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (loose .sql — not auto-applied by migrate deploy).
-- One nullable column so the Locations page can say WHICH agency the widget
-- is connected to instead of a bare company id. Backfilled automatically on
-- the next sync/reconnect. Additive only — safe to run anytime.
-- ---------------------------------------------------------------------------

ALTER TABLE "AgencyConnection" ADD COLUMN IF NOT EXISTS "companyName" TEXT;
