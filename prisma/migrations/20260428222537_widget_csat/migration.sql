-- Visitor satisfaction (CSAT) on widget conversations. Additive.
ALTER TABLE "WidgetConversation"
  ADD COLUMN IF NOT EXISTS "csatRating"      INTEGER,
  ADD COLUMN IF NOT EXISTS "csatComment"     TEXT,
  ADD COLUMN IF NOT EXISTS "csatSubmittedAt" TIMESTAMP;
