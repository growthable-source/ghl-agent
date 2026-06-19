-- Google content connector (Drive now, Gmail later) — hand-run DDL.
-- Matches the GoogleContentConnection model added to prisma/schema.prisma on
-- 2026-06-19. No Prisma migration file is created; the build's
-- `prisma migrate deploy` stays a no-op for this change.
--
-- The whole feature is dormant until GOOGLE_CONTENT_ENABLED=true and the
-- Drive API + Picker key are provisioned on the existing Google Cloud project,
-- so this table simply sits empty until then.

CREATE TABLE IF NOT EXISTS "GoogleContentConnection" (
  "id"           TEXT NOT NULL,
  "workspaceId"  TEXT NOT NULL,
  "email"        TEXT,
  "refreshToken" TEXT NOT NULL,
  "scopes"       TEXT NOT NULL DEFAULT '',
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GoogleContentConnection_pkey" PRIMARY KEY ("id")
);

-- One connection per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS "GoogleContentConnection_workspaceId_key"
  ON "GoogleContentConnection" ("workspaceId");

-- FK + cascade (apply once — Postgres has no ADD CONSTRAINT IF NOT EXISTS).
ALTER TABLE "GoogleContentConnection"
  ADD CONSTRAINT "GoogleContentConnection_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
