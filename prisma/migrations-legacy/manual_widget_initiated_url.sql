-- ─── Per-conversation "initiated from" URL ─────────────────────────────────
-- Captures the page a visitor was on when they first opened the chat. Distinct
-- from WidgetVisitor.currentUrl (which tracks them as they keep browsing) —
-- this column is frozen at create-time so operators know whether the chat
-- started on /pricing vs /docs even if the visitor has navigated since.
--
-- Safe to re-run.

ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "initiatedUrl"   TEXT;
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "initiatedTitle" TEXT;
