-- ═══════════════════════════════════════════════════════════════════════════
-- Admin Phase 2: role levels, 2FA enrolment columns, system settings.
-- Idempotent — safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- Role levels: viewer | admin | super. Default "admin" for existing rows.
ALTER TABLE "SuperAdmin"
  ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'admin';

-- TOTP 2FA.
ALTER TABLE "SuperAdmin"
  ADD COLUMN IF NOT EXISTS "twoFactorSecret" TEXT;
ALTER TABLE "SuperAdmin"
  ADD COLUMN IF NOT EXISTS "twoFactorVerifiedAt" TIMESTAMP(3);

-- SystemSetting: key/value store for admin-owned config.
CREATE TABLE IF NOT EXISTS "SystemSetting" (
  "key"       TEXT PRIMARY KEY,
  "value"     JSONB NOT NULL,
  "updatedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
