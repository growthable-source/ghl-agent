-- ─── Per-agent toggle for the quiet check-in cron ─────────────────────────
-- When a widget conversation goes 3+ minutes since the agent's last reply
-- and the visitor hasn't responded, the stale-conversations cron sends one
-- brief in-voice "still around?" message. This flag lets operators turn it
-- off on a per-agent basis when check-ins would feel pushy (broadcast
-- follow-ups, high-volume support flows).
--
-- Default true so existing agents inherit the behaviour the cron is
-- already shipping with — operators can flip off in the agent settings UI
-- if it doesn't suit their flow.
--
-- Safe to re-run.

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "enableQuietCheckIn" BOOLEAN NOT NULL DEFAULT true;
