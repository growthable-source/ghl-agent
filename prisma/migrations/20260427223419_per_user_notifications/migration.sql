-- Per-user notification preferences + browser push subscriptions.
-- Lives alongside the existing workspace-level NotificationChannel; the
-- two systems fan out independently.

CREATE TABLE IF NOT EXISTS "UserNotificationPreference" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "event"       TEXT NOT NULL,                                  -- e.g. "widget.new_conversation"
  "channels"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],        -- subset of ["email","web_push"]
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserNotificationPreference_user_workspace_event_key"
  ON "UserNotificationPreference"("userId", "workspaceId", "event");
CREATE INDEX IF NOT EXISTS "UserNotificationPreference_workspaceId_event_idx"
  ON "UserNotificationPreference"("workspaceId", "event");

CREATE TABLE IF NOT EXISTS "WebPushSubscription" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "endpoint"    TEXT NOT NULL,                                   -- unique per browser device
  "p256dh"      TEXT NOT NULL,
  "auth"        TEXT NOT NULL,
  "userAgent"   TEXT,
  "lastUsedAt"  TIMESTAMP NOT NULL DEFAULT NOW(),
  "createdAt"   TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "WebPushSubscription_endpoint_key"
  ON "WebPushSubscription"("endpoint");
CREATE INDEX IF NOT EXISTS "WebPushSubscription_userId_workspaceId_idx"
  ON "WebPushSubscription"("userId", "workspaceId");
