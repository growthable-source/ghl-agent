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

-- Default voice = ElevenLabs "Sarah". ElevenLabs works end-to-end with the
-- keys we already have: previews play in the picker (public sample URLs) AND
-- calls run via Vapi. Cartesia would need a CARTESIA_API_KEY we don't have,
-- so its previews can't play — hence ElevenLabs is the default.

-- 1. Give every Gemini voice agent an ElevenLabs VapiConfig if it lacks one.
--    NOTE: VapiConfig.id is a Prisma cuid generated in the APP layer, so it
--    has no DB default — raw SQL must supply an id. gen_random_uuid() (PG13+)
--    gives a unique String id; the column is just text, format doesn't matter.
INSERT INTO "VapiConfig" ("id", "agentId", "ttsProvider", "voiceId", "voiceName", "isActive")
SELECT gen_random_uuid()::text, a."id", 'elevenlabs', 'EXAVITQu4vr4xnSDxMaL', 'Sarah', true
FROM "Agent" a
LEFT JOIN "VapiConfig" v ON v."agentId" = a."id"
WHERE a."voiceRuntime" = 'gemini'
  AND v."agentId" IS NULL;

-- 2. Flip the runtime discriminator so the dashboard + inbound router treat
--    these as Vapi agents.
UPDATE "Agent"
SET "voiceRuntime" = 'vapi'
WHERE "voiceRuntime" = 'gemini';

-- 3. Move the agents the FIRST migration parked on Cartesia/Katie onto
--    ElevenLabs/Sarah, so their picker previews work (Cartesia previews
--    need a key we don't have). Scoped to the auto-migrated default voice
--    so anyone who deliberately picked a different Cartesia voice is left
--    alone.
UPDATE "VapiConfig"
SET "ttsProvider" = 'elevenlabs',
    "voiceId" = 'EXAVITQu4vr4xnSDxMaL',
    "voiceName" = 'Sarah'
WHERE "ttsProvider" = 'cartesia'
  AND "voiceId" = 'f786b574-daa5-4673-aa0c-cbe3e8534c02';

COMMIT;

-- Verify:
--   SELECT "voiceRuntime", COUNT(*) FROM "Agent" GROUP BY "voiceRuntime";
--   -- expect zero rows with 'gemini'.
