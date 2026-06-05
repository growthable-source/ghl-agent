-- 2026-06-06 — Voice AI Round 5: capitalize voice ids + force re-sync
--
-- Vapi rejects lowercase Vapi-native voice ids with a typed 400
-- ("voice.voiceId must be one of the following values: Clara, Godfrey,
-- Elliot, …"). Round 4 shipped lowercase ('elliot'); this corrects the
-- persisted state.
--
-- Safe to run multiple times. The runtime adapter (buildVapiVoiceBlock)
-- now also canonicalises voiceId on the way to Vapi, so the SQL is
-- belt + suspenders.
--
-- Run by hand per repo convention (Ryan applies all SQL — see CLAUDE.md).

BEGIN;

-- 1) Capitalize Vapi-native voice ids in place. INITCAP works for the
--    single-token names Vapi uses (Elliot, Cole, Naina, etc.). Filters
--    to rows that are currently lowercase to avoid touching already-correct
--    rows on a re-run.
UPDATE "VapiConfig"
   SET "voiceId" = INITCAP("voiceId"),
       "voiceName" = INITCAP("voiceId")
 WHERE "ttsProvider" = 'vapi'
   AND "voiceId" IS NOT NULL
   AND "voiceId" = lower("voiceId");

-- 2) Clear vapiAssistantId on EVERY vapi-engine row so the next save
--    re-registers the assistant with the canonical (capitalized)
--    voiceId. ensureVapiAssistant() in lib/voice/vapi-assistant.ts
--    handles the lazy backfill — operators see green ✓ on first save
--    instead of an opaque "save succeeded but test calls eject".
UPDATE "VapiConfig"
   SET "vapiAssistantId" = NULL
 WHERE "ttsProvider" = 'vapi';

COMMIT;

-- Verification queries (read-only).
-- After running, these should report:
--   • voiceId distribution: only capitalized names (Clara, Elliot, etc.)
--   • assistant id count: 0 immediately after; rebuilds as agents re-sync.
--
-- SELECT "voiceId", COUNT(*) FROM "VapiConfig" WHERE "ttsProvider"='vapi' GROUP BY 1 ORDER BY 1;
-- SELECT COUNT(*) FROM "VapiConfig" WHERE "ttsProvider"='vapi' AND "vapiAssistantId" IS NOT NULL;
