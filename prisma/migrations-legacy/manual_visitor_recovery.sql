-- ─── Cross-device chat recovery ─────────────────────────────────────────────
-- Magic-link table for resuming a chat when the visitor comes back on a
-- fresh device / cleared cookies. The /visitor identify endpoint detects
-- an email collision across cookieIds and emails the visitor a token; the
-- /recover endpoint consumes the token + re-points the original visitor
-- row at the new cookieId, so the conversation + assignee survive intact.
--
-- Also indexes WidgetVisitor by (widgetId, email) so the collision lookup
-- is a single-row hit on busy widgets.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS "VisitorRecoveryToken" (
  "id"        TEXT PRIMARY KEY,
  "token"     TEXT NOT NULL,
  "visitorId" TEXT NOT NULL,
  "widgetId"  TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitorRecoveryToken_visitorId_fkey"
    FOREIGN KEY ("visitorId") REFERENCES "WidgetVisitor"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "VisitorRecoveryToken_token_key"
  ON "VisitorRecoveryToken" ("token");
CREATE INDEX IF NOT EXISTS "VisitorRecoveryToken_visitorId_idx"
  ON "VisitorRecoveryToken" ("visitorId");
CREATE INDEX IF NOT EXISTS "VisitorRecoveryToken_expiresAt_idx"
  ON "VisitorRecoveryToken" ("expiresAt");

CREATE INDEX IF NOT EXISTS "WidgetVisitor_widgetId_email_idx"
  ON "WidgetVisitor" ("widgetId", "email");
