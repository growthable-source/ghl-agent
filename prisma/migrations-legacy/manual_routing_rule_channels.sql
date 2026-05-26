-- manual_routing_rule_channels.sql
--
-- Adds per-channel scoping to RoutingRule. Existing rows get an empty
-- array (= "applies to every channel the agent listens on" — preserves
-- current behaviour). New per-channel filters set channels[] to one or
-- more of: SMS, WhatsApp, FB, IG, GMB, Live_Chat, Email.
--
-- Routing match logic at lib/routing.ts treats empty channels[] as
-- "global rule"; non-empty as "only fires when the inbound channel is
-- in this list". Idempotent.

ALTER TABLE "RoutingRule"
  ADD COLUMN IF NOT EXISTS "channels" TEXT[] NOT NULL DEFAULT '{}';
