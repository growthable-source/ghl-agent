-- Idempotent on purpose (see 20261023120000_whitelabel_team_sign_in):
-- test builds may already have added this via
-- lib/whitelabel/ensure-test-schema.ts.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "whitelabelButtonTextColor" TEXT;
