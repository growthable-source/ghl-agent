-- Manual migration: widget auto-identify toggle + multi-agent launcher
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (loose .sql — not auto-applied by migrate deploy).
--   ChatWidget.autoIdentify   — CRM-dashboard visitors are pre-identified by
--                               the marketplace app's injected JS; ON by
--                               default, per-widget opt-out.
--   ChatWidget.launcherAgents — up to 2 launcher entries (chat/voice agent or
--                               live screen-share) so visitors pick the kind
--                               of help they need. NULL = classic launcher.
-- Additive only; widget-auth has select fallbacks so live widgets are safe
-- either side of this migration.
-- ---------------------------------------------------------------------------

ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "autoIdentify" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "launcherAgents" JSONB;
