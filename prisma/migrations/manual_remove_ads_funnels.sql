-- Manual migration: remove the ads & funnels layer
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (this file is NOT picked up by `prisma migrate
-- deploy` — only migration *folders* are). It drops the Xovera funnel layer
-- (Campaign / LandingPage / FormSubmission / ConversionEvent / PixelConfig)
-- and the ad-launcher layer (Meta + Google ad accounts, drafts, metrics,
-- recommendations, activity logs, autopilot rules, UTM templates), plus the
-- NativeContact campaign-attribution columns.
--
-- CASCADE handles the inter-table foreign keys, so ordering does not matter.
-- Wrapped in a transaction so a partial failure rolls back cleanly.
--
-- Generated to match schema.prisma after the ads/funnels removal. Verify
-- against the live DB before running; this destroys all rows in these tables.
-- ---------------------------------------------------------------------------

BEGIN;

-- NativeContact: drop campaign-attribution columns (FK dropped via CASCADE on Campaign).
ALTER TABLE "NativeContact"
  DROP COLUMN IF EXISTS "sourceCampaignId",
  DROP COLUMN IF EXISTS "sourceUrl",
  DROP COLUMN IF EXISTS "sourceUtm";

-- Ad-launcher layer
DROP TABLE IF EXISTS "AdAutopilotRule"      CASCADE;
DROP TABLE IF EXISTS "AdActivityLog"        CASCADE;
DROP TABLE IF EXISTS "AdRecommendation"     CASCADE;
DROP TABLE IF EXISTS "GoogleAdAsset"        CASCADE;
DROP TABLE IF EXISTS "GoogleCampaignDetail" CASCADE;
DROP TABLE IF EXISTS "GoogleAdMetric"       CASCADE;
DROP TABLE IF EXISTS "AdAudienceMetric"     CASCADE;
DROP TABLE IF EXISTS "AdCreativeMetric"     CASCADE;
DROP TABLE IF EXISTS "AdDailyMetric"        CASCADE;
DROP TABLE IF EXISTS "AdCampaignDraft"      CASCADE;
DROP TABLE IF EXISTS "GoogleAdAccount"      CASCADE;
DROP TABLE IF EXISTS "MetaAdAccount"        CASCADE;
DROP TABLE IF EXISTS "UtmTemplate"          CASCADE;

-- Funnel layer
DROP TABLE IF EXISTS "PixelConfig"          CASCADE;
DROP TABLE IF EXISTS "ConversionEvent"      CASCADE;
DROP TABLE IF EXISTS "FormSubmission"       CASCADE;
DROP TABLE IF EXISTS "BuildIteration"       CASCADE;
DROP TABLE IF EXISTS "LandingPageBuild"     CASCADE;
DROP TABLE IF EXISTS "LandingPage"          CASCADE;
DROP TABLE IF EXISTS "Campaign"             CASCADE;

COMMIT;
