-- ═══════════════════════════════════════════════════════════════════════════
-- Approval Queue: store channel + conversationProviderId on MessageLog so
-- the approval release knows WHERE to send when the human clicks approve.
-- Safe to run multiple times.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvalChannel" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN IF NOT EXISTS "approvalConversationProviderId" TEXT;
