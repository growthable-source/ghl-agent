-- Workspace Architecture Migration
-- Adds Workspace + WorkspaceMember models, and workspaceId FK to Location and Agent

-- 1. Create Workspace table
CREATE TABLE IF NOT EXISTS "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "agentLimit" INTEGER NOT NULL DEFAULT 1,
    "messageLimit" INTEGER NOT NULL DEFAULT 500,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "stripeCurrentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- 2. Create WorkspaceMember table
CREATE TABLE IF NOT EXISTS "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- 3. Add workspaceId to Location (nullable for migration)
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

-- 4. Add workspaceId to Agent (nullable for migration)
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

-- 5. Unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_slug_key" ON "Workspace"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_stripeCustomerId_key" ON "Workspace"("stripeCustomerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_stripeSubscriptionId_key" ON "Workspace"("stripeSubscriptionId");
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceMember_userId_workspaceId_key" ON "WorkspaceMember"("userId", "workspaceId");

-- 6. Indexes
CREATE INDEX IF NOT EXISTS "Location_workspaceId_idx" ON "Location"("workspaceId");
CREATE INDEX IF NOT EXISTS "Agent_workspaceId_idx" ON "Agent"("workspaceId");

-- 7. Foreign keys
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Location" ADD CONSTRAINT "Location_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. Backfill: Create a Workspace for each existing UserLocation owner, link locations + agents
-- This creates one workspace per unique (userId, locationId) owner combo
DO $$
DECLARE
  r RECORD;
  ws_id TEXT;
  ws_slug TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT ul."userId", ul."locationId"
    FROM "UserLocation" ul
    WHERE ul."role" = 'owner'
  LOOP
    ws_id := 'ws_' || substr(md5(random()::text), 1, 20);
    ws_slug := 'ws-' || substr(md5(r."locationId"::text), 1, 12);

    -- Create workspace (skip if slug exists)
    INSERT INTO "Workspace" ("id", "name", "slug", "updatedAt")
    VALUES (ws_id, 'My Workspace', ws_slug, NOW())
    ON CONFLICT ("slug") DO NOTHING;

    -- If slug already existed, get the existing workspace id
    SELECT w."id" INTO ws_id FROM "Workspace" w WHERE w."slug" = ws_slug;

    -- Create workspace member
    INSERT INTO "WorkspaceMember" ("id", "userId", "workspaceId", "role")
    VALUES ('wm_' || substr(md5(random()::text), 1, 20), r."userId", ws_id, 'owner')
    ON CONFLICT ("userId", "workspaceId") DO NOTHING;

    -- Link location to workspace
    UPDATE "Location" SET "workspaceId" = ws_id WHERE "id" = r."locationId" AND "workspaceId" IS NULL;

    -- Link agents to workspace
    UPDATE "Agent" SET "workspaceId" = ws_id WHERE "locationId" = r."locationId" AND "workspaceId" IS NULL;
  END LOOP;
END $$;
