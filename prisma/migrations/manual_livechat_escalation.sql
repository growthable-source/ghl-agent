-- Manual migration: time-based operator escalation for live chat
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (loose .sql — not auto-applied by migrate deploy).
-- Adds config + a cron debounce column for escalating stalled live chats:
--   LiveChatSettings.escalateAfterMinutes  — 0 = off (default); minutes a
--     waiting visitor tolerates before the assigned operator is escalated
--   LiveChatSettings.escalateReassign      — also return the chat to the queue
--   WidgetConversation.escalatedNotifiedAt — cron debounce (cleared on next msg)
-- Additive only; defaults keep existing behaviour (escalation off). Safe anytime.
-- ---------------------------------------------------------------------------

ALTER TABLE "LiveChatSettings"
  ADD COLUMN IF NOT EXISTS "escalateAfterMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "escalateReassign"     BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "WidgetConversation"
  ADD COLUMN IF NOT EXISTS "escalatedNotifiedAt" TIMESTAMP(3);
