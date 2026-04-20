-- ═══════════════════════════════════════════════════════════════════════════
-- WidgetConversation.staleNotifiedAt — cron debounce for conversation.stale.
-- Set when we've paged about a thread; cleared when the visitor replies.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "WidgetConversation"
  ADD COLUMN IF NOT EXISTS "staleNotifiedAt" TIMESTAMP(3);
