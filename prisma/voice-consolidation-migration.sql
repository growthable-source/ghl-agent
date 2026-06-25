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

-- Default voice = Cartesia (Sonic) "Katie" — Vapi's own default provider and
-- the most human-sounding voice. With CARTESIA_API_KEY set, picker previews
-- synth on demand AND calls run via Vapi. (ElevenLabs remains a selectable
-- alternative.)

-- 1. Give every Gemini voice agent a Cartesia VapiConfig if it lacks one.
--    NOTE: VapiConfig.id is a Prisma cuid generated in the APP layer, so it
--    has no DB default — raw SQL must supply an id. gen_random_uuid() (PG13+)
--    gives a unique String id; the column is just text, format doesn't matter.
INSERT INTO "VapiConfig" ("id", "agentId", "ttsProvider", "voiceId", "voiceName", "isActive")
SELECT gen_random_uuid()::text, a."id", 'cartesia', 'f786b574-daa5-4673-aa0c-cbe3e8534c02', 'Katie', true
FROM "Agent" a
LEFT JOIN "VapiConfig" v ON v."agentId" = a."id"
WHERE a."voiceRuntime" = 'gemini'
  AND v."agentId" IS NULL;

-- 2. Flip the runtime discriminator so the dashboard + inbound router treat
--    these as Vapi agents.
UPDATE "Agent"
SET "voiceRuntime" = 'vapi'
WHERE "voiceRuntime" = 'gemini';

-- 3. Normalise auto-migrated agents onto Cartesia/Katie. Idempotent and
--    safe whichever interim default they landed on (Cartesia/Katie or the
--    brief ElevenLabs/Sarah stopgap); leaves deliberately-chosen voices alone.
UPDATE "VapiConfig"
SET "ttsProvider" = 'cartesia',
    "voiceId" = 'f786b574-daa5-4673-aa0c-cbe3e8534c02',
    "voiceName" = 'Katie'
WHERE ("ttsProvider" = 'elevenlabs' AND "voiceId" = 'EXAVITQu4vr4xnSDxMaL')
   OR ("ttsProvider" = 'cartesia'  AND "voiceId" = 'f786b574-daa5-4673-aa0c-cbe3e8534c02');

COMMIT;

-- Verify:
--   SELECT "voiceRuntime", COUNT(*) FROM "Agent" GROUP BY "voiceRuntime";
--   -- expect zero rows with 'gemini'.
