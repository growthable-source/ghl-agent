-- manual_workspace_install_source.sql
--
-- Adds two columns to Workspace that together describe install provenance
-- + active primary CRM:
--
--   installSource       — telemetry, set once at workspace creation. Drives
--                         "Recommended for your setup" copy + analytics.
--   primaryCrmProvider  — sort order on the integrations page and the
--                         default crmProvider for new agents. Mutable.
--
-- Run by hand (per the "SQL by hand only" workflow). The Prisma client
-- generated from schema.prisma after this date assumes both columns exist
-- and will throw at runtime against an un-migrated DB — apply this before
-- deploying the matching app version.

ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "installSource" TEXT;

ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "primaryCrmProvider" TEXT NOT NULL DEFAULT 'native';

-- Backfill primaryCrmProvider for existing workspaces by reading the most
-- recently installed real Location. Workspaces with only placeholder/none
-- Locations stay at the 'native' default.
UPDATE "Workspace" w
SET "primaryCrmProvider" = COALESCE(
  (
    SELECT l."crmProvider"
    FROM "Location" l
    WHERE l."workspaceId" = w.id
      AND l."crmProvider" != 'none'
    ORDER BY l."installedAt" DESC
    LIMIT 1
  ),
  'native'
)
WHERE w."primaryCrmProvider" = 'native';
-- installSource intentionally stays NULL for legacy workspaces. The UI
-- treats NULL as "unknown / direct" — no guessing.
