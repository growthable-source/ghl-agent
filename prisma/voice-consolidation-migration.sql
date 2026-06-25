-- Voice consolidation — migrate Gemini voice agents onto Vapi (Cartesia).
-- Run by hand in production (Ryan's workflow — nothing auto-runs).
--
-- Context: voice agents are consolidating onto one runtime (Vapi). The
-- browser-direct Gemini Live stack is being retired. Any agent still
-- flagged voiceRuntime='gemini' needs (a) a VapiConfig row defaulted to
-- Cartesia (the most-human voice), and (b) its runtime flipped to 'vapi'.
--
-- The Vapi assistant itself syncs lazily on the next test call / save
-- (ensureVapiAssistant), or immediately if the operator opens the voice
-- page and hits Save — so no Vapi API call is needed from SQL.
--
-- NOTE: voiceRuntime ALSO self-heals: saving the Vapi voice config now sets
-- voiceRuntime='vapi'. This SQL is for agents you'd rather migrate in bulk
-- without opening each one.

BEGIN;

-- 1. Give every Gemini voice agent a Cartesia VapiConfig if it lacks one.
--    Katie (f786b574-...) is the warm conversational default; CARTESIA_MODEL
--    defaults to sonic-2 in code, so the model field is left to the app.
INSERT INTO "VapiConfig" ("agentId", "ttsProvider", "voiceId", "voiceName", "isActive")
SELECT a."id", 'cartesia', 'f786b574-daa5-4673-aa0c-cbe3e8534c02', 'Katie', true
FROM "Agent" a
LEFT JOIN "VapiConfig" v ON v."agentId" = a."id"
WHERE a."voiceRuntime" = 'gemini'
  AND v."agentId" IS NULL;

-- 2. Flip the runtime discriminator so the dashboard + inbound router treat
--    these as Vapi agents.
UPDATE "Agent"
SET "voiceRuntime" = 'vapi'
WHERE "voiceRuntime" = 'gemini';

-- 3. (Optional) Point any EXISTING Vapi agents still on the legacy
--    ElevenLabs seed default at Cartesia/Katie so they get the most-human
--    voice too. Comment out if you want to leave configured agents alone.
-- UPDATE "VapiConfig"
-- SET "ttsProvider" = 'cartesia',
--     "voiceId" = 'f786b574-daa5-4673-aa0c-cbe3e8534c02',
--     "voiceName" = 'Katie'
-- WHERE "ttsProvider" = 'vapi'
--   AND "voiceId" = 'EXAVITQu4vr4xnSDxMaL';

COMMIT;

-- Verify:
--   SELECT "voiceRuntime", COUNT(*) FROM "Agent" GROUP BY "voiceRuntime";
--   -- expect zero rows with 'gemini'.
