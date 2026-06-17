-- Slack widget-bridge: per-workspace Slack install, outbound queue,
-- inbound event dedup, and per-agent / per-conversation bridge state.
-- Idempotent (Ryan applies prod SQL by hand; build never auto-runs).

CREATE TABLE IF NOT EXISTS "SlackConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL UNIQUE,
  "teamId" TEXT NOT NULL,
  "teamName" TEXT,
  "botToken" TEXT NOT NULL,
  "botUserId" TEXT NOT NULL,
  "appId" TEXT,
  "scopes" TEXT,
  "defaultChannelId" TEXT,
  "defaultChannelName" TEXT,
  "installedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SlackConnection_teamId_idx" ON "SlackConnection"("teamId");

CREATE TABLE IF NOT EXISTS "SlackOutbox" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "threadTs" TEXT,
  "kind" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "blocks" JSONB,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "slackTs" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "SlackOutbox_status_createdAt_idx" ON "SlackOutbox"("status","createdAt");
CREATE INDEX IF NOT EXISTS "SlackOutbox_conversationId_idx" ON "SlackOutbox"("conversationId");

CREATE TABLE IF NOT EXISTS "ProcessedSlackEvent" (
  "eventId" TEXT NOT NULL PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ProcessedSlackEvent_createdAt_idx" ON "ProcessedSlackEvent"("createdAt");

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "slackBridgeMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "slackChannelId" TEXT;

ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "slackChannelId" TEXT;
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "slackThreadTs" TEXT;

DO $$ BEGIN
  ALTER TABLE "SlackConnection" ADD CONSTRAINT "SlackConnection_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SlackConnection" ADD CONSTRAINT "SlackConnection_installedByUserId_fkey"
    FOREIGN KEY ("installedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
