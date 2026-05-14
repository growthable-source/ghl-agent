-- ─── Team / inbox features (brand AI toggle, AI summary, presence log) ─────
-- Three additive columns + one new table. Safe to re-run.

-- 1. Per-brand AI on/off. When false, widgets tagged to this brand skip
--    the AI agent entirely — human-only support.
ALTER TABLE "Brand"
  ADD COLUMN IF NOT EXISTS "aiEnabled" BOOLEAN NOT NULL DEFAULT true;

-- 2. Cached AI summary for inbox quick-scan.
ALTER TABLE "WidgetConversation"
  ADD COLUMN IF NOT EXISTS "aiSummary"   TEXT,
  ADD COLUMN IF NOT EXISTS "aiSummaryAt" TIMESTAMP(3);

-- 3. Audit log of when each member toggled availability.
CREATE TABLE IF NOT EXISTS "MemberPresenceEvent" (
  "id"          TEXT PRIMARY KEY,
  "memberId"    TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "state"       TEXT NOT NULL,            -- 'available' | 'away'
  "source"      TEXT NOT NULL DEFAULT 'self',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberPresenceEvent_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "WorkspaceMember"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "MemberPresenceEvent_memberId_createdAt_idx"
  ON "MemberPresenceEvent" ("memberId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "MemberPresenceEvent_workspaceId_createdAt_idx"
  ON "MemberPresenceEvent" ("workspaceId", "createdAt" DESC);
