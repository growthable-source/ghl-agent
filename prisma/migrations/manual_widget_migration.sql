-- ═══════════════════════════════════════════════════════════════════════════
-- Chat Widget Migration — Intercom-clone for website visitors
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

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
CREATE INDEX IF NOT EXISTS "WidgetVisitor_widgetId_lastSeenAt_idx" ON "WidgetVisitor"("widgetId","lastSeenAt");

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
CREATE INDEX IF NOT EXISTS "WidgetConversation_widgetId_lastMessageAt_idx" ON "WidgetConversation"("widgetId","lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "WidgetConversation_visitorId_idx" ON "WidgetConversation"("visitorId");
CREATE INDEX IF NOT EXISTS "WidgetConversation_agentId_status_idx" ON "WidgetConversation"("agentId","status");

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
CREATE INDEX IF NOT EXISTS "WidgetMessage_conversationId_createdAt_idx" ON "WidgetMessage"("conversationId","createdAt" ASC);

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
CREATE INDEX IF NOT EXISTS "WidgetVoiceCall_conversationId_idx" ON "WidgetVoiceCall"("conversationId");
