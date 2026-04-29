-- ═══════════════════════════════════════════════════════════════════════════
-- manual_widget_full.sql — every widget-related migration in one paste.
--
-- Brings the widget system fully up to date in one shot:
--   1. Base widget tables (ChatWidget, WidgetVisitor, WidgetConversation,
--      WidgetMessage, WidgetVoiceCall)
--   2. Click-to-call widget type + hosted call page + button styling
--   3. WidgetConversation.staleNotifiedAt (stale-cron debounce)
--   4. CSAT (csatRating, csatComment, csatSubmittedAt)
--   5. Widget folders (WidgetFolder + ChatWidget.folderId)
--   6. Inbox routing & assignment (Intercom-style)
--      - WorkspaceMember.isAvailable + availabilityChangedAt
--      - ChatWidget.routingMode + routingTargetUserIds + routingLastAssignedUserId
--      - WidgetConversation.assignedUserId + assignedAt + assignmentReason
--
-- Idempotent. Safe to run multiple times. Order matters: earlier blocks
-- create tables that later blocks add columns to.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. Base widget tables ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ChatWidget" (
  "id"              TEXT PRIMARY KEY,
  "workspaceId"     TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "publicKey"       TEXT UNIQUE NOT NULL,
  "primaryColor"    TEXT NOT NULL DEFAULT '#fa4d2e',
  "logoUrl"         TEXT,
  "title"           TEXT NOT NULL DEFAULT 'Chat with us',
  "subtitle"        TEXT NOT NULL DEFAULT 'We typically reply within a minute',
  "welcomeMessage"  TEXT NOT NULL DEFAULT 'Hi! How can we help?',
  "position"        TEXT NOT NULL DEFAULT 'bottom-right',
  "requireEmail"    BOOLEAN NOT NULL DEFAULT false,
  "askForNameEmail" BOOLEAN NOT NULL DEFAULT true,
  "voiceEnabled"    BOOLEAN NOT NULL DEFAULT false,
  "voiceAgentId"    TEXT,
  "defaultAgentId"  TEXT,
  "allowedDomains"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isActive"        BOOLEAN NOT NULL DEFAULT true,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ChatWidget_workspaceId_idx" ON "ChatWidget"("workspaceId");

CREATE TABLE IF NOT EXISTS "WidgetVisitor" (
  "id"           TEXT PRIMARY KEY,
  "widgetId"     TEXT NOT NULL,
  "cookieId"     TEXT NOT NULL,
  "email"        TEXT,
  "name"         TEXT,
  "phone"        TEXT,
  "firstSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "crmContactId" TEXT,
  "userAgent"    TEXT,
  "ipAddress"    TEXT,
  CONSTRAINT "WidgetVisitor_widgetId_cookieId_key" UNIQUE ("widgetId","cookieId"),
  CONSTRAINT "WidgetVisitor_widgetId_fkey"
    FOREIGN KEY ("widgetId") REFERENCES "ChatWidget"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "WidgetVisitor_widgetId_lastSeenAt_idx"
  ON "WidgetVisitor"("widgetId","lastSeenAt");

CREATE TABLE IF NOT EXISTS "WidgetConversation" (
  "id"            TEXT PRIMARY KEY,
  "widgetId"      TEXT NOT NULL,
  "visitorId"     TEXT NOT NULL,
  "agentId"       TEXT,
  "status"        TEXT NOT NULL DEFAULT 'active',
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WidgetConversation_widgetId_fkey"
    FOREIGN KEY ("widgetId") REFERENCES "ChatWidget"("id") ON DELETE CASCADE,
  CONSTRAINT "WidgetConversation_visitorId_fkey"
    FOREIGN KEY ("visitorId") REFERENCES "WidgetVisitor"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "WidgetConversation_widgetId_lastMessageAt_idx"
  ON "WidgetConversation"("widgetId","lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "WidgetConversation_visitorId_idx"
  ON "WidgetConversation"("visitorId");
CREATE INDEX IF NOT EXISTS "WidgetConversation_agentId_status_idx"
  ON "WidgetConversation"("agentId","status");

CREATE TABLE IF NOT EXISTS "WidgetMessage" (
  "id"             TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "role"           TEXT NOT NULL,
  "content"        TEXT NOT NULL,
  "kind"           TEXT NOT NULL DEFAULT 'text',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WidgetMessage_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "WidgetConversation"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "WidgetMessage_conversationId_createdAt_idx"
  ON "WidgetMessage"("conversationId","createdAt" ASC);

CREATE TABLE IF NOT EXISTS "WidgetVoiceCall" (
  "id"             TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "vapiCallId"     TEXT,
  "status"         TEXT NOT NULL DEFAULT 'requested',
  "startedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"        TIMESTAMP(3),
  "durationSecs"   INTEGER,
  "transcript"     TEXT,
  CONSTRAINT "WidgetVoiceCall_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "WidgetConversation"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "WidgetVoiceCall_conversationId_idx"
  ON "WidgetVoiceCall"("conversationId");


-- ─── 2. Click-to-call type + hosted page + button styling ────────────────

ALTER TABLE "ChatWidget"
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS "slug" TEXT,
  ADD COLUMN IF NOT EXISTS "embedMode" TEXT NOT NULL DEFAULT 'floating',
  ADD COLUMN IF NOT EXISTS "buttonLabel" TEXT NOT NULL DEFAULT 'Talk to us',
  ADD COLUMN IF NOT EXISTS "buttonShape" TEXT NOT NULL DEFAULT 'pill',
  ADD COLUMN IF NOT EXISTS "buttonSize" TEXT NOT NULL DEFAULT 'md',
  ADD COLUMN IF NOT EXISTS "buttonIcon" TEXT NOT NULL DEFAULT 'phone',
  ADD COLUMN IF NOT EXISTS "buttonTextColor" TEXT NOT NULL DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS "hostedPageHeadline" TEXT,
  ADD COLUMN IF NOT EXISTS "hostedPageSubtext" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ChatWidget_slug_key" ON "ChatWidget"("slug");


-- ─── 3. Stale-cron debounce ───────────────────────────────────────────────

ALTER TABLE "WidgetConversation"
  ADD COLUMN IF NOT EXISTS "staleNotifiedAt" TIMESTAMP(3);


-- ─── 4. CSAT ratings ──────────────────────────────────────────────────────

ALTER TABLE "WidgetConversation"
  ADD COLUMN IF NOT EXISTS "csatRating"      INTEGER,
  ADD COLUMN IF NOT EXISTS "csatComment"     TEXT,
  ADD COLUMN IF NOT EXISTS "csatSubmittedAt" TIMESTAMP;


-- ─── 5. Widget folders ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "WidgetFolder" (
  "id"          TEXT PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "color"       TEXT,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "WidgetFolder_workspaceId_order_idx"
  ON "WidgetFolder"("workspaceId", "order");

ALTER TABLE "ChatWidget"
  ADD COLUMN IF NOT EXISTS "folderId" TEXT;
CREATE INDEX IF NOT EXISTS "ChatWidget_folderId_idx" ON "ChatWidget"("folderId");


-- ─── 6. Inbox routing + assignment (Intercom-style) ──────────────────────

-- WorkspaceMember presence flag
ALTER TABLE "WorkspaceMember"
  ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "availabilityChangedAt" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "WorkspaceMember_workspaceId_isAvailable_idx"
  ON "WorkspaceMember"("workspaceId", "isAvailable");

-- ChatWidget routing config
ALTER TABLE "ChatWidget"
  ADD COLUMN IF NOT EXISTS "routingMode" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS "routingTargetUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "routingLastAssignedUserId" TEXT;

-- WidgetConversation assignee + audit fields
ALTER TABLE "WidgetConversation"
  ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "assignmentReason" TEXT;

CREATE INDEX IF NOT EXISTS "WidgetConversation_assignedUserId_status_idx"
  ON "WidgetConversation"("assignedUserId", "status");

DO $$ BEGIN
  ALTER TABLE "WidgetConversation"
    ADD CONSTRAINT "WidgetConversation_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
