-- Customer Portals — read-only customer-facing view onto a workspace's
-- conversations, scoped by brand. Auth/session pipeline is separate from
-- NextAuth (workspace operators) and SuperAdmin (platform admins).
--
-- Four tables:
--   Portal           — one per workspace, branded login surface
--   PortalUser       — invited users belonging to a Portal
--   PortalUserBrand  — which brands each user can see (the access gate)
--   PortalInvite     — pending email-token invites
--
-- All additive. No backfill — the customer portal is opt-in per workspace.

CREATE TABLE IF NOT EXISTS "Portal" (
  "id"           TEXT PRIMARY KEY,
  "workspaceId"  TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "slug"         TEXT NOT NULL,
  "logoUrl"      TEXT,
  "primaryColor" TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "Portal_slug_key" ON "Portal"("slug");
CREATE INDEX IF NOT EXISTS "Portal_workspaceId_idx" ON "Portal"("workspaceId");

DO $$ BEGIN
  ALTER TABLE "Portal"
    ADD CONSTRAINT "Portal_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PortalUser" (
  "id"           TEXT PRIMARY KEY,
  "portalId"     TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "name"         TEXT,
  "passwordHash" TEXT,
  "isActive"     BOOLEAN NOT NULL DEFAULT TRUE,
  "lastLoginAt"  TIMESTAMP,
  "invitedAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "acceptedAt"   TIMESTAMP,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "PortalUser_portalId_email_key"
  ON "PortalUser"("portalId", "email");
CREATE INDEX IF NOT EXISTS "PortalUser_email_idx" ON "PortalUser"("email");

DO $$ BEGIN
  ALTER TABLE "PortalUser"
    ADD CONSTRAINT "PortalUser_portalId_fkey"
    FOREIGN KEY ("portalId") REFERENCES "Portal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PortalUserBrand" (
  "id"           TEXT PRIMARY KEY,
  "portalUserId" TEXT NOT NULL,
  "brandId"      TEXT NOT NULL,
  "createdAt"    TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "PortalUserBrand_portalUserId_brandId_key"
  ON "PortalUserBrand"("portalUserId", "brandId");
CREATE INDEX IF NOT EXISTS "PortalUserBrand_brandId_idx" ON "PortalUserBrand"("brandId");

DO $$ BEGIN
  ALTER TABLE "PortalUserBrand"
    ADD CONSTRAINT "PortalUserBrand_portalUserId_fkey"
    FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PortalUserBrand"
    ADD CONSTRAINT "PortalUserBrand_brandId_fkey"
    FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PortalInvite" (
  "id"         TEXT PRIMARY KEY,
  "portalId"   TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "tokenHash"  TEXT NOT NULL,
  "brandIds"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "invitedBy"  TEXT,
  "acceptedAt" TIMESTAMP,
  "expiresAt"  TIMESTAMP NOT NULL,
  "createdAt"  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "PortalInvite_tokenHash_key"
  ON "PortalInvite"("tokenHash");
CREATE UNIQUE INDEX IF NOT EXISTS "PortalInvite_portalId_email_key"
  ON "PortalInvite"("portalId", "email");
CREATE INDEX IF NOT EXISTS "PortalInvite_email_idx" ON "PortalInvite"("email");

DO $$ BEGIN
  ALTER TABLE "PortalInvite"
    ADD CONSTRAINT "PortalInvite_portalId_fkey"
    FOREIGN KEY ("portalId") REFERENCES "Portal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
