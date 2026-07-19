-- Auto-pilot mode columns on Agent.
--
-- Hand-run in production (SQL-by-hand workflow). Purely additive and
-- idempotent — safe to run more than once. Until this runs, the app degrades
-- gracefully: the PATCH route retries without these fields (isMissingColumn),
-- and the webhook's loadAutopilotSettings() returns safe defaults, so the
-- config page and inbound pipeline keep working with the features simply off.
--
-- Ships with:
--   • sleepOnManualMessage / sleepOnWorkflowMessage — the double-booking fix
--     (agent sleeps when a human/workflow sends an outbound message, so it
--     never reacts to its own booking confirmation and books twice).
--   • autopilotWaitSeconds — widens the inbound debounce/coalesce window.
--   • maxBotMessages — hard per-conversation cap before pausing for a human.
--   • respondToImages / respondToVoiceNotes — attachment gating.

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "autopilotWaitSeconds"   INTEGER;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "maxBotMessages"         INTEGER;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "respondToImages"        BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "respondToVoiceNotes"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "sleepOnManualMessage"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "sleepOnWorkflowMessage" BOOLEAN NOT NULL DEFAULT false;
