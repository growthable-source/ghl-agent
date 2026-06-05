-- 2026-06-06 — Voice AI overhaul Round 4
--
-- Mirrors Vapi's demo "Riley" assistant exactly: Vapi-native voice
-- (Elliot) + OpenAI gpt-4.1 + Deepgram nova-3. The model + transcriber
-- defaults are in lib/voice/vapi-assistant.ts (with env-var overrides);
-- this SQL aligns the VapiConfig.ttsProvider + voiceId rows.
--
-- Safe to run multiple times. Each UPDATE narrows to rows that still
-- need the change.
--
-- Run by hand per repo convention (Ryan applies all SQL — see CLAUDE.md).

BEGIN;

-- 1) Normalise ElevenLabs naming. Pre-Phase-A code persisted legacy
--    'vapi' / '11labs' values on VapiConfig.ttsProvider for what we
--    now call the ElevenLabs engine. Rewrite to the canonical
--    'elevenlabs' string so resolveVoiceEngine() reads cleanly.
UPDATE "VapiConfig"
   SET "ttsProvider" = 'elevenlabs'
 WHERE "ttsProvider" IN ('vapi', '11labs');

-- 2) Migrate xAI agents to Vapi-native + Elliot. xAI has been removed
--    from the platform; existing rows get the new default stack.
UPDATE "VapiConfig"
   SET "ttsProvider" = 'vapi',
       "voiceId" = 'elliot',
       "voiceName" = 'Elliot'
 WHERE "ttsProvider" = 'xai';

-- 3) Clear ALL vapiAssistantId so every voice agent re-registers with
--    Vapi on next save / call. ensureVapiAssistant() in
--    lib/voice/vapi-assistant.ts handles the lazy backfill: the next
--    call (browser or phone) needing an assistantId hits POST /assistant
--    with the new defaults (OpenAI gpt-4.1 + Deepgram nova-3 +
--    matching voice block) and persists the id back here. Skip the
--    intermediate state by clearing right after the SQL runs.
UPDATE "VapiConfig"
   SET "vapiAssistantId" = NULL;

COMMIT;

-- Verification queries (read-only).
--
-- After running the BEGIN block above, these should report:
--   • no rows with legacy ttsProvider values
--   • every voice agent on either 'vapi' or 'elevenlabs'
--   • zero rows with a stale vapiAssistantId
--
-- SELECT "ttsProvider", COUNT(*) FROM "VapiConfig" GROUP BY "ttsProvider";
-- SELECT COUNT(*) FROM "VapiConfig" WHERE "vapiAssistantId" IS NOT NULL;
