-- Meta (Messenger + Instagram) first-class conversations + messages.
--
-- Mirrors the shape of WidgetConversation/WidgetMessage so the inbox
-- can union them into a single feed with a channel pill per row.
-- Assignment, status, lastMessageAt etc. are deliberately kept
-- name-compatible with WidgetConversation.

CREATE TABLE IF NOT EXISTS "MetaConversation" (
  "id"                 TEXT PRIMARY KEY,
  "workspaceId"        TEXT NOT NULL,
  "locationId"         TEXT NOT NULL,
  -- 'messenger' | 'instagram' — drives icon + which Graph endpoints to use
  "channel"            TEXT NOT NULL,
  -- Page/IG-Business ID that received the inbound (entry.id from webhook)
  "pageId"             TEXT NOT NULL,
  "pageName"           TEXT,
  -- Sender's PSID (Messenger) or IGSID (Instagram). Stable per (page, user).
  "senderId"           TEXT NOT NULL,
  "senderName"         TEXT,
  "senderProfilePicUrl" TEXT,
  "agentId"            TEXT,
  "status"             TEXT NOT NULL DEFAULT 'active',
  "lastMessageAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastMessagePreview" TEXT,
  "lastMessageDirection" TEXT,    -- 'in' | 'out'
  "unreadCount"        INTEGER NOT NULL DEFAULT 0,
  "assignedUserId"     TEXT,
  "assignedAt"         TIMESTAMP,
  "assignmentReason"   TEXT,
  "createdAt"          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- A given (page, sender) pair is one conversation. Per-channel because
  -- the same FB user could DM both your Page (Messenger) and your IG.
  CONSTRAINT "MetaConversation_pageId_senderId_channel_key" UNIQUE ("pageId", "senderId", "channel"),

  CONSTRAINT "MetaConversation_assignedUser_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "MetaConversation_workspaceId_lastMessageAt_idx"
  ON "MetaConversation" ("workspaceId", "lastMessageAt" DESC);
CREATE INDEX IF NOT EXISTS "MetaConversation_locationId_idx"
  ON "MetaConversation" ("locationId");
CREATE INDEX IF NOT EXISTS "MetaConversation_assignedUserId_status_idx"
  ON "MetaConversation" ("assignedUserId", "status");


CREATE TABLE IF NOT EXISTS "MetaMessage" (
  "id"             TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  -- 'in' = end user → us, 'out' = agent/operator → end user
  "direction"      TEXT NOT NULL,
  "text"           TEXT,
  -- Meta's message id (mid). Used to dedupe webhook retries on inbound.
  "mid"            TEXT,
  "sentByUserId"   TEXT,                -- non-null for human (operator) replies
  "metadata"       JSONB,               -- attachments, postback payload, etc.
  "createdAt"      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MetaMessage_conversation_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "MetaConversation"("id") ON DELETE CASCADE,
  CONSTRAINT "MetaMessage_sentByUser_fkey"
    FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL
);

-- Dedupe across webhook retries. Partial index because outbound messages
-- have no mid (we don't get an mid back synchronously from Send API for
-- every message type).
CREATE UNIQUE INDEX IF NOT EXISTS "MetaMessage_mid_unique"
  ON "MetaMessage" ("mid") WHERE "mid" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "MetaMessage_conversationId_createdAt_idx"
  ON "MetaMessage" ("conversationId", "createdAt");
