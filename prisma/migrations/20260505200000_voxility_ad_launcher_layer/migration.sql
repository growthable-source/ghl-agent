-- Voxility ad-launcher layer: Meta + Google ad accounts, AI campaign
-- drafts, daily metric snapshots, AI recommendations, account audit
-- log, autopilot rules, UTM templates.
--
-- Strictly additive — no existing column altered. Idempotent — every
-- CREATE/ALTER guards against re-application so it's safe to run more
-- than once (matches the pattern used by 20260504073000_native_crm).

-- ─── MetaAdAccount ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MetaAdAccount" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "accountName"      TEXT NOT NULL,
  "metaAccountId"    TEXT NOT NULL,
  "accessToken"      TEXT NOT NULL,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "autoPilotEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetaAdAccount_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "MetaAdAccount"
    ADD CONSTRAINT "MetaAdAccount_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "MetaAdAccount_workspaceId_metaAccountId_key"
  ON "MetaAdAccount"("workspaceId", "metaAccountId");
CREATE INDEX IF NOT EXISTS "MetaAdAccount_workspaceId_isActive_idx"
  ON "MetaAdAccount"("workspaceId", "isActive");

-- ─── GoogleAdAccount ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GoogleAdAccount" (
  "id"               TEXT NOT NULL,
  "workspaceId"      TEXT NOT NULL,
  "accountName"      TEXT NOT NULL,
  "googleCustomerId" TEXT NOT NULL,
  "refreshToken"     TEXT NOT NULL,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "autoPilotEnabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleAdAccount_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "GoogleAdAccount"
    ADD CONSTRAINT "GoogleAdAccount_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "GoogleAdAccount_workspaceId_googleCustomerId_key"
  ON "GoogleAdAccount"("workspaceId", "googleCustomerId");
CREATE INDEX IF NOT EXISTS "GoogleAdAccount_workspaceId_isActive_idx"
  ON "GoogleAdAccount"("workspaceId", "isActive");

-- ─── AdCampaignDraft ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdCampaignDraft" (
  "id"                 TEXT NOT NULL,
  "workspaceId"        TEXT NOT NULL,
  "campaignId"         TEXT,
  "platform"           TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "payload"            JSONB NOT NULL,
  "aiReasoning"        TEXT,
  "externalCampaignId" TEXT,
  "createdBy"          TEXT NOT NULL,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdCampaignDraft_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AdCampaignDraft"
    ADD CONSTRAINT "AdCampaignDraft_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AdCampaignDraft"
    ADD CONSTRAINT "AdCampaignDraft_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "AdCampaignDraft_workspaceId_platform_createdAt_idx"
  ON "AdCampaignDraft"("workspaceId", "platform", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AdCampaignDraft_campaignId_idx"
  ON "AdCampaignDraft"("campaignId");

-- ─── AdDailyMetric ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdDailyMetric" (
  "id"          TEXT NOT NULL,
  "accountId"   TEXT NOT NULL,
  "date"        DATE NOT NULL,
  "spend"       DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "leads"       INTEGER NOT NULL DEFAULT 0,
  "impressions" BIGINT NOT NULL DEFAULT 0,
  "clicks"      INTEGER NOT NULL DEFAULT 0,
  "cpl"         DECIMAL(10, 4),
  "cpm"         DECIMAL(10, 4),
  "ctr"         DECIMAL(8, 4),
  "cpc"         DECIMAL(10, 4),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdDailyMetric_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AdDailyMetric"
    ADD CONSTRAINT "AdDailyMetric_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AdDailyMetric_accountId_date_key"
  ON "AdDailyMetric"("accountId", "date");
CREATE INDEX IF NOT EXISTS "AdDailyMetric_accountId_date_idx"
  ON "AdDailyMetric"("accountId", "date" DESC);

-- ─── AdCreativeMetric ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdCreativeMetric" (
  "id"          TEXT NOT NULL,
  "accountId"   TEXT NOT NULL,
  "date"        DATE NOT NULL,
  "adId"        TEXT NOT NULL,
  "adName"      TEXT,
  "status"      TEXT,
  "spend"       DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "impressions" BIGINT NOT NULL DEFAULT 0,
  "clicks"      INTEGER NOT NULL DEFAULT 0,
  "leads"       INTEGER NOT NULL DEFAULT 0,
  "ctr"         DECIMAL(8, 4),
  "cpl"         DECIMAL(10, 4),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdCreativeMetric_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AdCreativeMetric"
    ADD CONSTRAINT "AdCreativeMetric_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "AdCreativeMetric_accountId_adId_date_key"
  ON "AdCreativeMetric"("accountId", "adId", "date");
CREATE INDEX IF NOT EXISTS "AdCreativeMetric_accountId_date_idx"
  ON "AdCreativeMetric"("accountId", "date" DESC);

-- ─── AdAudienceMetric ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdAudienceMetric" (
  "id"                TEXT NOT NULL,
  "accountId"         TEXT NOT NULL,
  "date"              DATE NOT NULL,
  "adId"              TEXT NOT NULL,
  "adName"            TEXT,
  "age"               TEXT,
  "gender"            TEXT,
  "publisherPlatform" TEXT,
  "country"           TEXT,
  "spend"             DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "impressions"       BIGINT NOT NULL DEFAULT 0,
  "clicks"            INTEGER NOT NULL DEFAULT 0,
  "leads"             INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdAudienceMetric_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AdAudienceMetric"
    ADD CONSTRAINT "AdAudienceMetric_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "AdAudienceMetric_accountId_date_idx"
  ON "AdAudienceMetric"("accountId", "date" DESC);

-- ─── GoogleAdMetric ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GoogleAdMetric" (
  "id"                TEXT NOT NULL,
  "accountId"         TEXT NOT NULL,
  "date"              DATE NOT NULL,
  "campaignId"        TEXT NOT NULL,
  "adGroupId"         TEXT,
  "adId"              TEXT,
  "keywordId"         TEXT,
  "spend"             DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "impressions"       BIGINT NOT NULL DEFAULT 0,
  "clicks"            INTEGER NOT NULL DEFAULT 0,
  "conversions"       DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "conversionValue"   DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "ctr"               DECIMAL(8, 4),
  "cpc"               DECIMAL(10, 4),
  "cpm"               DECIMAL(10, 4),
  "costPerConversion" DECIMAL(10, 4),
  "qualityScore"      INTEGER,
  "impressionShare"   DECIMAL(8, 4),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleAdMetric_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "GoogleAdMetric"
    ADD CONSTRAINT "GoogleAdMetric_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "GoogleAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "GoogleAdMetric_accountId_date_idx"
  ON "GoogleAdMetric"("accountId", "date" DESC);
CREATE INDEX IF NOT EXISTS "GoogleAdMetric_accountId_campaignId_date_idx"
  ON "GoogleAdMetric"("accountId", "campaignId", "date" DESC);

-- ─── GoogleCampaignDetail ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GoogleCampaignDetail" (
  "id"                    TEXT NOT NULL,
  "accountId"             TEXT NOT NULL,
  "campaignId"            TEXT NOT NULL,
  "biddingStrategyType"   TEXT,
  "budgetAmount"          DECIMAL(12, 2),
  "searchImpressionShare" DECIMAL(8, 4),
  "searchLostIsBudget"    DECIMAL(8, 4),
  "searchLostIsRank"      DECIMAL(8, 4),
  "syncedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleCampaignDetail_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "GoogleCampaignDetail"
    ADD CONSTRAINT "GoogleCampaignDetail_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "GoogleAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "GoogleCampaignDetail_accountId_campaignId_key"
  ON "GoogleCampaignDetail"("accountId", "campaignId");
CREATE INDEX IF NOT EXISTS "GoogleCampaignDetail_accountId_idx"
  ON "GoogleCampaignDetail"("accountId");

-- ─── GoogleAdAsset ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "GoogleAdAsset" (
  "id"               TEXT NOT NULL,
  "accountId"        TEXT NOT NULL,
  "campaignId"       TEXT NOT NULL,
  "adGroupId"        TEXT NOT NULL,
  "adId"             TEXT NOT NULL,
  "assetType"        TEXT NOT NULL,
  "assetText"        TEXT,
  "performanceLabel" TEXT,
  "pinnedField"      TEXT,
  "impressions"      BIGINT NOT NULL DEFAULT 0,
  "clicks"           INTEGER NOT NULL DEFAULT 0,
  "conversions"      DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "spend"            DECIMAL(12, 2) NOT NULL DEFAULT 0,
  "syncedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleAdAsset_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "GoogleAdAsset"
    ADD CONSTRAINT "GoogleAdAsset_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "GoogleAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "GoogleAdAsset_accountId_adId_idx"
  ON "GoogleAdAsset"("accountId", "adId");
CREATE INDEX IF NOT EXISTS "GoogleAdAsset_accountId_performanceLabel_idx"
  ON "GoogleAdAsset"("accountId", "performanceLabel");

-- ─── AdRecommendation ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdRecommendation" (
  "id"              TEXT NOT NULL,
  "metaAccountId"   TEXT,
  "googleAccountId" TEXT,
  "category"        TEXT NOT NULL DEFAULT 'budget',
  "title"           TEXT NOT NULL,
  "description"     TEXT NOT NULL,
  "rationale"       TEXT,
  "affectedEntity"  TEXT,
  "expectedImpact"  TEXT,
  "impactRange"     TEXT,
  "priority"        TEXT NOT NULL DEFAULT 'medium',
  "confidence"      TEXT NOT NULL DEFAULT 'medium',
  "status"          TEXT NOT NULL DEFAULT 'pending',
  "actionSteps"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "draftNegatives"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "draftCopy"       JSONB,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdRecommendation_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AdRecommendation"
    ADD CONSTRAINT "AdRecommendation_metaAccountId_fkey"
    FOREIGN KEY ("metaAccountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AdRecommendation"
    ADD CONSTRAINT "AdRecommendation_googleAccountId_fkey"
    FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "AdRecommendation_metaAccountId_status_createdAt_idx"
  ON "AdRecommendation"("metaAccountId", "status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AdRecommendation_googleAccountId_status_createdAt_idx"
  ON "AdRecommendation"("googleAccountId", "status", "createdAt" DESC);

-- ─── AdActivityLog ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdActivityLog" (
  "id"              TEXT NOT NULL,
  "metaAccountId"   TEXT,
  "googleAccountId" TEXT,
  "actionType"      TEXT NOT NULL,
  "description"     TEXT NOT NULL,
  "details"         JSONB,
  "performedBy"     TEXT NOT NULL DEFAULT 'system',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdActivityLog_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AdActivityLog"
    ADD CONSTRAINT "AdActivityLog_metaAccountId_fkey"
    FOREIGN KEY ("metaAccountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AdActivityLog"
    ADD CONSTRAINT "AdActivityLog_googleAccountId_fkey"
    FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "AdActivityLog_metaAccountId_createdAt_idx"
  ON "AdActivityLog"("metaAccountId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AdActivityLog_googleAccountId_createdAt_idx"
  ON "AdActivityLog"("googleAccountId", "createdAt" DESC);

-- ─── AdAutopilotRule ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AdAutopilotRule" (
  "id"              TEXT NOT NULL,
  "metaAccountId"   TEXT,
  "googleAccountId" TEXT,
  "ruleName"        TEXT NOT NULL,
  "ruleType"        TEXT NOT NULL,
  "threshold"       DECIMAL(12, 4),
  "isEnabled"       BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdAutopilotRule_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "AdAutopilotRule"
    ADD CONSTRAINT "AdAutopilotRule_metaAccountId_fkey"
    FOREIGN KEY ("metaAccountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AdAutopilotRule"
    ADD CONSTRAINT "AdAutopilotRule_googleAccountId_fkey"
    FOREIGN KEY ("googleAccountId") REFERENCES "GoogleAdAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "AdAutopilotRule_metaAccountId_isEnabled_idx"
  ON "AdAutopilotRule"("metaAccountId", "isEnabled");
CREATE INDEX IF NOT EXISTS "AdAutopilotRule_googleAccountId_isEnabled_idx"
  ON "AdAutopilotRule"("googleAccountId", "isEnabled");

-- ─── UtmTemplate ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UtmTemplate" (
  "id"           TEXT NOT NULL,
  "workspaceId"  TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "baseUrl"      TEXT NOT NULL,
  "utmSource"    TEXT,
  "utmMedium"    TEXT,
  "utmCampaign"  TEXT,
  "utmTerm"      TEXT,
  "utmContent"   TEXT,
  "customParams" JSONB,
  "createdBy"    TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UtmTemplate_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "UtmTemplate"
    ADD CONSTRAINT "UtmTemplate_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "UtmTemplate_workspaceId_name_key"
  ON "UtmTemplate"("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "UtmTemplate_workspaceId_idx"
  ON "UtmTemplate"("workspaceId");

-- ─── PixelConfig: add ad-account FKs ──────────────────────────────────
-- Existing PixelConfig pointed at the generic Integration table when ad
-- accounts weren't first-class. Add new direct FKs to MetaAdAccount /
-- GoogleAdAccount; conversion-fire prefers these when set.
DO $$ BEGIN
  ALTER TABLE "PixelConfig" ADD COLUMN "metaAdAccountId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PixelConfig" ADD COLUMN "googleAdAccountId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PixelConfig"
    ADD CONSTRAINT "PixelConfig_metaAdAccountId_fkey"
    FOREIGN KEY ("metaAdAccountId") REFERENCES "MetaAdAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PixelConfig"
    ADD CONSTRAINT "PixelConfig_googleAdAccountId_fkey"
    FOREIGN KEY ("googleAdAccountId") REFERENCES "GoogleAdAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
