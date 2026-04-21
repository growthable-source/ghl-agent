-- ═══════════════════════════════════════════════════════════════════════════
-- Super-admin backend tables: SuperAdmin + AdminAuditLog.
--
-- SuperAdmin is the DB-backed allowlist for the /admin cockpit, with
-- bcrypt password hashes for Credentials-provider login. Replaces the
-- env-var allowlist for /admin only — the help-center admin gate
-- (lib/help-auth.ts) still honours SUPER_ADMIN_EMAILS for back-compat.
--
-- AdminAuditLog captures every meaningful admin action (login, export,
-- webhook fire) with IP + UA for forensics. Retention is a policy call;
-- we don't auto-prune.
--
-- Idempotent. Safe to re-run after partial failures.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "SuperAdmin" (
  "id"           TEXT PRIMARY KEY,
  "email"        TEXT NOT NULL UNIQUE,
  "passwordHash" TEXT NOT NULL,
  "name"         TEXT,
  "lastLoginAt"  TIMESTAMP(3),
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "SuperAdmin_email_idx" ON "SuperAdmin"("email");

CREATE TABLE IF NOT EXISTS "AdminAuditLog" (
  "id"         TEXT PRIMARY KEY,
  "adminId"    TEXT,
  "adminEmail" TEXT NOT NULL,
  "action"     TEXT NOT NULL,
  "target"     TEXT,
  "meta"       JSONB,
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id")
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "AdminAuditLog_adminId_createdAt_idx"
  ON "AdminAuditLog"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_action_createdAt_idx"
  ON "AdminAuditLog"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_createdAt_idx"
  ON "AdminAuditLog"("createdAt");
