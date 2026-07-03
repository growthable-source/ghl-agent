-- Manual migration: per-user report recipients + weekly-by-default reports
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (loose .sql — not auto-applied by migrate deploy).
--
-- 1. PortalUser.receiveReports — include/exclude a user from the portal's
--    scheduled report emails. Everyone ON by default.
-- 2. Portal.reportFrequency defaults to 'weekly' for new portals, and the
--    backfill flips every existing 'off' portal to weekly ("turn everyone
--    on by default as of now"). Portals someone already set to daily keep
--    their choice.
--
-- Additive + one benign UPDATE — safe to run anytime.
-- ---------------------------------------------------------------------------

ALTER TABLE "PortalUser" ADD COLUMN IF NOT EXISTS "receiveReports" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Portal" ALTER COLUMN "reportFrequency" SET DEFAULT 'weekly';

UPDATE "Portal" SET "reportFrequency" = 'weekly' WHERE "reportFrequency" = 'off';
