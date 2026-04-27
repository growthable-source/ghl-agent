-- Workspace-scoped data sources: Google Sheets / Airtable / saved REST
-- endpoints the agent can query at runtime via the lookup_sheet,
-- query_airtable, and fetch_data tools.

CREATE TABLE IF NOT EXISTS "WorkspaceDataSource" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,                     -- slug-ish, referenced by tool calls
  "kind"        TEXT NOT NULL,                     -- 'google_sheet' | 'airtable' | 'rest_get'
  "description" TEXT,
  "config"      JSONB NOT NULL DEFAULT '{}'::JSONB,
  "secretEnc"   TEXT,                              -- encrypted token (lib/secrets.ts)
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceDataSource_workspaceId_name_key"
  ON "WorkspaceDataSource"("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "WorkspaceDataSource_workspaceId_idx"
  ON "WorkspaceDataSource"("workspaceId");
