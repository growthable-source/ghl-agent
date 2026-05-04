-- Voxility funnel layer: campaigns + landing pages + form submissions
-- + server-side conversion events + per-campaign pixel configs.
-- Workspace-scoped, plan-gated to Pro/Agency tiers in app code.
-- Strictly additive — does NOT alter or drop any existing column.
-- Idempotent — every CREATE/ALTER guards against re-application so it's
-- safe to run more than once.

-- ─── Campaign ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Campaign" (
  "id"                       TEXT NOT NULL,
  "workspaceId"              TEXT NOT NULL,
  "locationId"               TEXT,
  "name"                     TEXT NOT NULL,
  "goal"                     TEXT NOT NULL DEFAULT 'lead_gen',
  "status"                   TEXT NOT NULL DEFAULT 'draft',
  "offerSummary"             TEXT,
  "intake"                   JSONB,
  "brandVoice"               TEXT,
  "primaryColor"             TEXT DEFAULT '#0A84FF',
  "dailyBudget"              DECIMAL(10, 2),
  "totalBudget"              DECIMAL(10, 2),
  "startDate"                DATE,
  "endDate"                  DATE,
  "landingPageId"            TEXT,
  "triggeredAgentId"         TEXT,
  "conversationalAgentId"    TEXT,
  "metaCampaignExternalId"   TEXT,
  "googleCampaignExternalId" TEXT,
  "targetValuePerLead"       DECIMAL(10, 2),
  "notes"                    TEXT,
  "createdBy"                TEXT NOT NULL,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- triggeredAgent + conversationalAgent FKs are added BEFORE LandingPage FK
-- because LandingPage is created after Campaign — but Campaign.landingPageId
-- still gets its FK after LandingPage exists (see end of file).
DO $$ BEGIN
  ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_triggeredAgentId_fkey"
    FOREIGN KEY ("triggeredAgentId") REFERENCES "Agent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_conversationalAgentId_fkey"
    FOREIGN KEY ("conversationalAgentId") REFERENCES "Agent"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_landingPageId_key"
  ON "Campaign"("landingPageId");
CREATE INDEX IF NOT EXISTS "Campaign_workspaceId_status_idx"
  ON "Campaign"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "Campaign_workspaceId_createdAt_idx"
  ON "Campaign"("workspaceId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Campaign_locationId_idx"
  ON "Campaign"("locationId");

-- ─── LandingPage ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "LandingPage" (
  "id"                    TEXT NOT NULL,
  "workspaceId"           TEXT NOT NULL,
  "template"              TEXT NOT NULL DEFAULT 'vsl',
  "slug"                  TEXT NOT NULL,
  "title"                 TEXT NOT NULL,
  "spec"                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  "formSchema"            JSONB NOT NULL DEFAULT '{}'::jsonb,
  "metaPixelId"           TEXT,
  "googleConversionId"    TEXT,
  "googleConversionLabel" TEXT,
  "ogImageUrl"            TEXT,
  "metaDescription"       TEXT,
  "published"             BOOLEAN NOT NULL DEFAULT false,
  "publishedAt"           TIMESTAMP(3),
  "customDomain"          TEXT,
  "createdBy"             TEXT NOT NULL,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "LandingPage"
    ADD CONSTRAINT "LandingPage_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "LandingPage_slug_key"
  ON "LandingPage"("slug");
CREATE INDEX IF NOT EXISTS "LandingPage_workspaceId_idx"
  ON "LandingPage"("workspaceId");
CREATE INDEX IF NOT EXISTS "LandingPage_published_publishedAt_idx"
  ON "LandingPage"("published", "publishedAt" DESC);

-- Now that LandingPage exists, attach Campaign.landingPageId FK.
DO $$ BEGIN
  ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_landingPageId_fkey"
    FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── FormSubmission ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "FormSubmission" (
  "id"            TEXT NOT NULL,
  "workspaceId"   TEXT NOT NULL,
  "campaignId"    TEXT,
  "landingPageId" TEXT,
  "contactId"     TEXT,
  "rawPayload"    JSONB NOT NULL DEFAULT '{}'::jsonb,
  "utm"           JSONB NOT NULL DEFAULT '{}'::jsonb,
  "referrer"      TEXT,
  "ipAddress"     TEXT,
  "userAgent"     TEXT,
  "fbp"           TEXT,
  "fbc"           TEXT,
  "gclid"         TEXT,
  "submittedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "FormSubmission"
    ADD CONSTRAINT "FormSubmission_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FormSubmission"
    ADD CONSTRAINT "FormSubmission_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FormSubmission"
    ADD CONSTRAINT "FormSubmission_landingPageId_fkey"
    FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FormSubmission"
    ADD CONSTRAINT "FormSubmission_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "NativeContact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "FormSubmission_workspaceId_submittedAt_idx"
  ON "FormSubmission"("workspaceId", "submittedAt" DESC);
CREATE INDEX IF NOT EXISTS "FormSubmission_campaignId_submittedAt_idx"
  ON "FormSubmission"("campaignId", "submittedAt" DESC);
CREATE INDEX IF NOT EXISTS "FormSubmission_contactId_idx"
  ON "FormSubmission"("contactId");

-- ─── ConversionEvent ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ConversionEvent" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "campaignId"     TEXT,
  "contactId"      TEXT,
  "submissionId"   TEXT,
  "eventName"      TEXT NOT NULL,
  "eventId"        TEXT NOT NULL,
  "value"          DECIMAL(10, 2),
  "currency"       TEXT NOT NULL DEFAULT 'USD',
  "metaSentAt"     TIMESTAMP(3),
  "metaResponse"   JSONB,
  "metaError"      TEXT,
  "googleSentAt"   TIMESTAMP(3),
  "googleResponse" JSONB,
  "googleError"    TEXT,
  "occurredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversionEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "ConversionEvent"
    ADD CONSTRAINT "ConversionEvent_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversionEvent"
    ADD CONSTRAINT "ConversionEvent_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversionEvent"
    ADD CONSTRAINT "ConversionEvent_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "NativeContact"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversionEvent"
    ADD CONSTRAINT "ConversionEvent_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "FormSubmission"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "ConversionEvent_eventId_key"
  ON "ConversionEvent"("eventId");
CREATE INDEX IF NOT EXISTS "ConversionEvent_campaignId_eventName_occurredAt_idx"
  ON "ConversionEvent"("campaignId", "eventName", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ConversionEvent_contactId_idx"
  ON "ConversionEvent"("contactId");
CREATE INDEX IF NOT EXISTS "ConversionEvent_workspaceId_occurredAt_idx"
  ON "ConversionEvent"("workspaceId", "occurredAt" DESC);

-- ─── PixelConfig ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PixelConfig" (
  "id"                    TEXT NOT NULL,
  "workspaceId"           TEXT NOT NULL,
  "campaignId"            TEXT,
  "metaPixelId"           TEXT,
  "metaIntegrationId"     TEXT,
  "metaTestEventCode"     TEXT,
  "googleConversionId"    TEXT,
  "googleConversionLabel" TEXT,
  "googleIntegrationId"   TEXT,
  "eventValueMap"         JSONB NOT NULL DEFAULT '{}'::jsonb,
  "metaEvents"            TEXT[] NOT NULL DEFAULT ARRAY['lead', 'call_connected', 'qualified', 'booked', 'sale']::TEXT[],
  "googleEvents"          TEXT[] NOT NULL DEFAULT ARRAY['lead', 'call_connected', 'qualified', 'booked', 'sale']::TEXT[],
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PixelConfig_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "PixelConfig"
    ADD CONSTRAINT "PixelConfig_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PixelConfig"
    ADD CONSTRAINT "PixelConfig_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PixelConfig"
    ADD CONSTRAINT "PixelConfig_metaIntegrationId_fkey"
    FOREIGN KEY ("metaIntegrationId") REFERENCES "Integration"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PixelConfig"
    ADD CONSTRAINT "PixelConfig_googleIntegrationId_fkey"
    FOREIGN KEY ("googleIntegrationId") REFERENCES "Integration"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PixelConfig_campaignId_key"
  ON "PixelConfig"("campaignId");
CREATE INDEX IF NOT EXISTS "PixelConfig_workspaceId_idx"
  ON "PixelConfig"("workspaceId");

-- ─── NativeContact: funnel attribution columns ────────────────────────
-- Optional source tracking for contacts created via Voxility funnels.
-- All three columns are nullable so existing rows remain valid; no
-- backfill needed.
DO $$ BEGIN
  ALTER TABLE "NativeContact" ADD COLUMN "sourceCampaignId" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NativeContact" ADD COLUMN "sourceUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NativeContact" ADD COLUMN "sourceUtm" JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "NativeContact"
    ADD CONSTRAINT "NativeContact_sourceCampaignId_fkey"
    FOREIGN KEY ("sourceCampaignId") REFERENCES "Campaign"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "NativeContact_sourceCampaignId_idx"
  ON "NativeContact"("sourceCampaignId");
