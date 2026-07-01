-- Manual migration: distinguish human-operator replies from AI replies
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (loose .sql — not auto-applied by migrate deploy).
-- Adds the columns the inbox uses to show "AI" only for genuine agent replies:
--   WidgetMessage.sentByUserId            — operator id on live-chat replies
--   MetaConversation.lastMessageSentByUserId — denormalized operator id
-- Both nullable; existing rows stay NULL (treated as AI, unchanged behaviour).
-- Additive only — safe to run anytime, no backfill required.
-- ---------------------------------------------------------------------------

ALTER TABLE "WidgetMessage"    ADD COLUMN IF NOT EXISTS "sentByUserId"            TEXT;
ALTER TABLE "MetaConversation" ADD COLUMN IF NOT EXISTS "lastMessageSentByUserId" TEXT;
