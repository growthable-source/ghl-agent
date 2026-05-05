-- Voxility brand-kit fields on Campaign.
-- Strictly additive — no existing column altered. Idempotent — safe to
-- re-run.
DO $$ BEGIN
  ALTER TABLE "Campaign" ADD COLUMN "logoUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign" ADD COLUMN "brandGuideText" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign" ADD COLUMN "referenceUrl" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign" ADD COLUMN "extractedColors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
