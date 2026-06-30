-- MarketingLead — public marketing / signup lead capture.
--
-- This table has no Prisma migration (the build never auto-migrates); run
-- this by hand against prod. Idempotent: safe to run whether or not the
-- table already exists. Without it, every public lead form (demo-request,
-- signup-intent, newsletter) soft-fails and no leads are captured/synced.

CREATE TABLE IF NOT EXISTS "MarketingLead" (
    "id"        TEXT NOT NULL,
    "email"     TEXT NOT NULL,
    "source"    TEXT NOT NULL DEFAULT 'homepage',
    "utm"       JSONB,
    "referrer"  TEXT,
    "ipHash"    TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MarketingLead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketingLead_email_key" ON "MarketingLead" ("email");
CREATE INDEX IF NOT EXISTS "MarketingLead_createdAt_idx" ON "MarketingLead" ("createdAt");
