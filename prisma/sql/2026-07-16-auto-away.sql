-- Auto-away for live-chat routing. Run by hand in production
-- (Ryan's workflow — nothing auto-runs).
--
-- Context (Dan's report): the routing engine only assigns chats to
-- members whose Available pill is on, but the pill is a manual toggle
-- that defaults to on — off-shift agents who forget to flip it keep
-- receiving round-robin chats. Auto-away flips members to Away after N
-- minutes (workspace setting, default 15) without dashboard activity,
-- and flips them back the moment they're active again. Manual Away and
-- kiosk-admin writes are never auto-overridden.
--
-- Rollout is self-bootstrapping: the cron only sweeps members whose
-- lastActivityAt has been set at least once by the new heartbeat, so
-- applying this SQL flips nobody until each member is first seen active.

ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "presenceSource" TEXT NOT NULL DEFAULT 'self';
ALTER TABLE "WorkspaceMember" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "WorkspaceMember_isAvailable_lastActivityAt_idx"
  ON "WorkspaceMember"("isAvailable", "lastActivityAt");

ALTER TABLE "LiveChatSettings" ADD COLUMN IF NOT EXISTS "autoAwayEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "LiveChatSettings" ADD COLUMN IF NOT EXISTS "autoAwayMinutes" INTEGER NOT NULL DEFAULT 15;
